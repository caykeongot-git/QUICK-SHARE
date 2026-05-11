import { DurableObject } from 'cloudflare:workers';

// ─────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────

/** All possible signaling message types exchanged via WebSocket */
type SignalMessageType =
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'peer-joined'
  | 'peer-left'
  | 'error'
  | 'room-full'
  | 'room-info';

interface SignalMessage {
  type: SignalMessageType;
  payload?: unknown;
  /** Timestamp in ISO 8601 format */
  ts: string;
}

interface PeerInfo {
  joinedAt: number;
}

// ─────────────────────────────────────────────────
// RoomCoordinator Durable Object
// ─────────────────────────────────────────────────

/**
 * RoomCoordinator manages a single signaling room.
 *
 * - Max 2 peers per room (sender + receiver).
 * - Relays WebRTC signaling messages (offer/answer/ICE) between peers.
 * - NEVER inspects, logs, or stores payload data.
 * - Auto-cleans up after 30 minutes of inactivity via Alarm API.
 */
export class RoomCoordinator extends DurableObject<Env> {
  /** Active WebSocket connections mapped to peer metadata */
  private peers: Map<WebSocket, PeerInfo> = new Map();

  /** Inactivity timeout duration in milliseconds (30 minutes) */
  private static readonly IDLE_TIMEOUT_MS = 30 * 60 * 1000;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * Handle incoming HTTP requests — upgrade to WebSocket.
   */
  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');

    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    // Enforce max 2 peers per room
    if (this.peers.size >= 2) {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({
        type: 'room-full',
        payload: { message: 'Room is full. Maximum 2 peers allowed.' },
        ts: new Date().toISOString(),
      } satisfies SignalMessage));
      server.close(4001, 'Room is full');

      return new Response(null, { status: 101, webSocket: client });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Accept the server-side WebSocket via Hibernation API
    this.ctx.acceptWebSocket(server);

    const peerInfo: PeerInfo = { joinedAt: Date.now() };
    this.peers.set(server, peerInfo);

    // Notify the new peer about room state
    const roomInfoMsg: SignalMessage = {
      type: 'room-info',
      payload: {
        peerCount: this.peers.size,
        message: this.peers.size === 1
          ? 'Waiting for peer to join...'
          : 'Peer is already in the room. Ready to connect.',
      },
      ts: new Date().toISOString(),
    };
    server.send(JSON.stringify(roomInfoMsg));

    // Notify existing peer that a new peer joined
    if (this.peers.size === 2) {
      this.broadcast(server, {
        type: 'peer-joined',
        payload: { peerCount: 2 },
        ts: new Date().toISOString(),
      });
    }

    // Reset inactivity alarm
    await this.resetAlarm();

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Hibernation API: called when a WebSocket message is received.
   * Relay signaling messages to the other peer.
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Reset inactivity timer on any activity
    await this.resetAlarm();

    if (typeof message !== 'string') {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Binary messages are not supported. Send JSON strings only.' },
        ts: new Date().toISOString(),
      } satisfies SignalMessage));
      return;
    }

    let parsed: SignalMessage;
    try {
      parsed = JSON.parse(message) as SignalMessage;
    } catch {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Invalid JSON format.' },
        ts: new Date().toISOString(),
      } satisfies SignalMessage));
      return;
    }

    // Only relay signaling-relevant message types
    const ALLOWED_TYPES: ReadonlySet<string> = new Set([
      'offer', 'answer', 'ice-candidate',
    ]);

    if (!ALLOWED_TYPES.has(parsed.type)) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: `Message type "${parsed.type}" is not relayable.` },
        ts: new Date().toISOString(),
      } satisfies SignalMessage));
      return;
    }

    // Relay to the OTHER peer (not back to sender)
    this.broadcast(ws, parsed);
  }

  /**
   * Hibernation API: called when a WebSocket is closed.
   */
  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.peers.delete(ws);

    // Notify remaining peer
    this.broadcast(ws, {
      type: 'peer-left',
      payload: { peerCount: this.peers.size, code },
      ts: new Date().toISOString(),
    });

    // If room is empty, schedule cleanup
    if (this.peers.size === 0) {
      await this.ctx.storage.setAlarm(Date.now() + 5000); // Clean up in 5s
    }
  }

  /**
   * Hibernation API: called on WebSocket error.
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error);
    this.peers.delete(ws);

    this.broadcast(ws, {
      type: 'peer-left',
      payload: { peerCount: this.peers.size, error: 'Peer connection error' },
      ts: new Date().toISOString(),
    });
  }

  /**
   * Alarm handler — clean up idle rooms.
   */
  async alarm(): Promise<void> {
    // Close all remaining connections
    for (const [ws] of this.peers) {
      try {
        ws.close(4000, 'Room closed due to inactivity');
      } catch {
        // WebSocket may already be closed
      }
    }
    this.peers.clear();

    // Delete all stored state
    await this.ctx.storage.deleteAll();
  }

  // ─────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────

  /**
   * Send a message to all peers EXCEPT the sender.
   */
  private broadcast(sender: WebSocket, message: SignalMessage): void {
    const data = JSON.stringify(message);

    for (const [ws] of this.peers) {
      if (ws !== sender) {
        try {
          ws.send(data);
        } catch {
          // Peer may have disconnected
          this.peers.delete(ws);
        }
      }
    }
  }

  /**
   * Reset the inactivity alarm to 30 minutes from now.
   */
  private async resetAlarm(): Promise<void> {
    await this.ctx.storage.setAlarm(
      Date.now() + RoomCoordinator.IDLE_TIMEOUT_MS
    );
  }
}
