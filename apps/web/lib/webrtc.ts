/**
 * QuickShare — WebRTC P2P Connection Manager
 *
 * Manages the full lifecycle of a WebRTC peer connection:
 * 1. WebSocket signaling via Cloudflare Durable Objects
 * 2. RTCPeerConnection with mandatory TURN TCP/443 fallback
 * 3. RTCDataChannel with backpressure control for large files
 *
 * TURN TCP/443 config ensures QuickShare works even in strict
 * university/corporate networks that block UDP and use Symmetric NAT.
 *
 * @module webrtc
 */

import {
  encryptChunk,
  decryptChunk,
  DEFAULT_CHUNK_SIZE,
  chunkFile,
} from './crypto';

// ─────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────

/** Connection lifecycle states */
export type ConnectionStatus =
  | 'idle'
  | 'connecting'    // Connecting to signaling server
  | 'waiting'       // Waiting for peer to join
  | 'signaling'     // Exchanging SDP/ICE
  | 'connected'     // DataChannel open, ready to transfer
  | 'transferring'  // Active file/text transfer
  | 'done'          // Transfer complete
  | 'error';        // Connection failed

/** Transfer progress information */
export interface TransferProgress {
  /** Total bytes to transfer */
  totalBytes: number;
  /** Bytes transferred so far */
  transferredBytes: number;
  /** Progress ratio (0.0 to 1.0) */
  ratio: number;
  /** Current transfer speed in bytes/second */
  speed: number;
  /** Filename being transferred (if file) */
  fileName?: string;
}

/** File metadata sent before the actual data */
export interface FileMetadata {
  type: 'meta';
  fileName: string;
  fileSize: number;
  fileType: string;
  totalChunks: number;
  chunkSize: number;
}

/** Data chunk message */
export interface ChunkMessage {
  type: 'chunk';
  index: number;
}

/** Transfer completion message */
export interface DoneMessage {
  type: 'done';
  totalChunks: number;
}

/** Text transfer message */
export interface TextMessage {
  type: 'text';
  content: string;
}

/** All possible data channel message types */
export type DataMessage = FileMetadata | ChunkMessage | DoneMessage | TextMessage;

/** Signaling message from the server */
interface SignalMessage {
  type: string;
  payload?: Record<string, unknown>;
  ts: string;
}

/** ICE server configuration — designed for env var injection */
export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Events emitted by WebRTCManager */
export interface WebRTCEvents {
  onStatusChange: (status: ConnectionStatus) => void;
  onProgress: (progress: TransferProgress) => void;
  onTextReceived: (text: string) => void;
  onFileReceived: (file: Blob, metadata: FileMetadata) => void;
  onError: (error: Error) => void;
  onPeerJoined: () => void;
  onPeerLeft: () => void;
}

// ─────────────────────────────────────────────────
// Default ICE Configuration
// ─────────────────────────────────────────────────

/**
 * Build ICE server configuration.
 *
 * Accepts external STUN/TURN credentials via parameters so
 * Metered.ca (or any TURN provider) keys can be injected
 * from environment variables at build time.
 *
 * CRITICAL: The TURN server MUST listen on TCP port 443.
 * This disguises WebRTC traffic as HTTPS, bypassing university
 * firewalls that block UDP.
 */
export function buildIceConfig(
  turnServers: IceServerConfig[] = []
): RTCConfiguration {
  const defaultStun: IceServerConfig[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  return {
    iceServers: [...defaultStun, ...turnServers],
    iceCandidatePoolSize: 10,
    // Use 'relay' only if direct connection is impossible
    // 'all' tries direct first, falls back to TURN
    iceTransportPolicy: 'all',
  };
}

// ─────────────────────────────────────────────────
// WebRTC Manager
// ─────────────────────────────────────────────────

export class WebRTCManager {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private encryptionKey: CryptoKey | null = null;

  private status: ConnectionStatus = 'idle';
  private events: Partial<WebRTCEvents> = {};
  private iceConfig: RTCConfiguration;

  /** Backpressure threshold in bytes (256KB) */
  private static readonly BUFFER_THRESHOLD = 256 * 1024;

  /** DataChannel chunk size for binary data */
  private static readonly DC_CHUNK_SIZE = DEFAULT_CHUNK_SIZE;

  /** Received chunks buffer for file assembly */
  private receivedChunks: ArrayBuffer[] = [];
  private receivedMeta: FileMetadata | null = null;

  /** Speed calculation */
  private transferStartTime = 0;
  private totalTransferred = 0;

  constructor(
    turnServers: IceServerConfig[] = [],
    events: Partial<WebRTCEvents> = {}
  ) {
    this.iceConfig = buildIceConfig(turnServers);
    this.events = events;
  }

  // ─────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────

  /**
   * Set the E2EE encryption key (from crypto module).
   */
  setEncryptionKey(key: CryptoKey): void {
    this.encryptionKey = key;
  }

  /**
   * Connect to a signaling room as the SENDER (creates offer).
   *
   * @param signalingUrl - WebSocket URL to the signaling server
   * @param roomId - Room ID to join
   */
  async connectAsSender(signalingUrl: string, roomId: string): Promise<void> {
    this.setStatus('connecting');
    await this.connectSignaling(signalingUrl, roomId);

    // Sender waits for peer-joined, then creates offer
    // (handled in onSignalingMessage)
  }

  /**
   * Connect to a signaling room as the RECEIVER (waits for offer).
   *
   * @param signalingUrl - WebSocket URL to the signaling server
   * @param roomId - Room ID to join
   */
  async connectAsReceiver(signalingUrl: string, roomId: string): Promise<void> {
    this.setStatus('connecting');
    await this.connectSignaling(signalingUrl, roomId);
    this.initPeerConnection(false);
  }

  /**
   * Send a file over the encrypted P2P DataChannel.
   *
   * Flow: chunk file → encrypt each chunk → send via DataChannel
   * with backpressure control.
   */
  async sendFile(file: File): Promise<void> {
    if (!this.dc || this.dc.readyState !== 'open') {
      throw new Error('DataChannel is not open.');
    }
    if (!this.encryptionKey) {
      throw new Error('Encryption key not set.');
    }

    this.setStatus('transferring');
    this.transferStartTime = Date.now();
    this.totalTransferred = 0;

    const chunkSize = WebRTCManager.DC_CHUNK_SIZE;
    const totalChunks = Math.ceil(file.size / chunkSize);

    // Send metadata first (unencrypted — just filename/size info)
    const meta: FileMetadata = {
      type: 'meta',
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/octet-stream',
      totalChunks,
      chunkSize,
    };
    this.dc.send(JSON.stringify(meta));

    // Stream encrypted chunks with backpressure
    let chunkIndex = 0;
    for await (const chunk of chunkFile(file, chunkSize)) {
      const encrypted = await encryptChunk(this.encryptionKey, chunk);

      // Backpressure: wait if buffer is too full
      await this.waitForBufferDrain();

      // Send chunk index header + encrypted data
      const header = new TextEncoder().encode(
        JSON.stringify({ type: 'chunk', index: chunkIndex } satisfies ChunkMessage)
      );
      // Send header then binary data
      this.dc.send(JSON.stringify({ type: 'chunk', index: chunkIndex }));
      this.dc.send(encrypted);

      chunkIndex++;
      this.totalTransferred += chunk.byteLength;
      this.emitProgress(file.size, file.name);
    }

    // Send completion signal
    const done: DoneMessage = { type: 'done', totalChunks };
    this.dc.send(JSON.stringify(done));
    this.setStatus('done');
  }

  /**
   * Send a text snippet over the encrypted P2P DataChannel.
   */
  async sendText(text: string): Promise<void> {
    if (!this.dc || this.dc.readyState !== 'open') {
      throw new Error('DataChannel is not open.');
    }
    if (!this.encryptionKey) {
      throw new Error('Encryption key not set.');
    }

    this.setStatus('transferring');

    // Encrypt the text
    const encoder = new TextEncoder();
    const encrypted = await encryptChunk(
      this.encryptionKey,
      encoder.encode(text).buffer
    );

    // Send as text message with encrypted payload
    const msg: TextMessage = { type: 'text', content: '' };
    this.dc.send(JSON.stringify(msg));
    this.dc.send(encrypted);

    this.setStatus('done');
  }

  /**
   * Gracefully disconnect and clean up all resources.
   */
  disconnect(): void {
    this.dc?.close();
    this.pc?.close();
    this.ws?.close();
    this.dc = null;
    this.pc = null;
    this.ws = null;
    this.receivedChunks = [];
    this.receivedMeta = null;
    this.setStatus('idle');
  }

  /**
   * Get current connection status.
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  // ─────────────────────────────────────────────────
  // Signaling (WebSocket)
  // ─────────────────────────────────────────────────

  private connectSignaling(signalingUrl: string, roomId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${signalingUrl}/api/room/${roomId}/ws`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.setStatus('waiting');
        resolve();
      };

      this.ws.onmessage = (event) => {
        this.onSignalingMessage(event.data as string);
      };

      this.ws.onerror = () => {
        const err = new Error('WebSocket connection failed.');
        this.setStatus('error');
        this.events.onError?.(err);
        reject(err);
      };

      this.ws.onclose = () => {
        if (this.status !== 'done' && this.status !== 'idle') {
          this.events.onPeerLeft?.();
        }
      };
    });
  }

  private async onSignalingMessage(raw: string): Promise<void> {
    let msg: SignalMessage;
    try {
      msg = JSON.parse(raw) as SignalMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'peer-joined':
        this.events.onPeerJoined?.();
        // If we're the sender (waiting), create offer
        if (this.status === 'waiting' && !this.pc) {
          this.initPeerConnection(true);
          await this.createAndSendOffer();
        }
        break;

      case 'offer':
        this.setStatus('signaling');
        await this.handleOffer(msg.payload as { sdp: RTCSessionDescriptionInit });
        break;

      case 'answer':
        await this.handleAnswer(msg.payload as { sdp: RTCSessionDescriptionInit });
        break;

      case 'ice-candidate':
        await this.handleIceCandidate(
          msg.payload as { candidate: RTCIceCandidateInit }
        );
        break;

      case 'peer-left':
        this.events.onPeerLeft?.();
        break;

      case 'room-full':
        this.setStatus('error');
        this.events.onError?.(new Error('Room is full.'));
        break;

      case 'room-info':
        // Check if peer is already in room
        if (
          msg.payload &&
          (msg.payload as { peerCount: number }).peerCount === 2
        ) {
          this.events.onPeerJoined?.();
        }
        break;
    }
  }

  // ─────────────────────────────────────────────────
  // Peer Connection
  // ─────────────────────────────────────────────────

  private initPeerConnection(isSender: boolean): void {
    this.pc = new RTCPeerConnection(this.iceConfig);

    // Send ICE candidates to remote peer via signaling
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignaling('ice-candidate', {
          candidate: event.candidate.toJSON(),
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc?.connectionState === 'failed') {
        this.setStatus('error');
        this.events.onError?.(new Error('Peer connection failed.'));
      }
    };

    if (isSender) {
      // Sender creates the DataChannel
      this.dc = this.pc.createDataChannel('quickshare', {
        ordered: true, // Ensure chunks arrive in order
      });
      this.dc.binaryType = 'arraybuffer';
      this.setupDataChannel(this.dc);
    } else {
      // Receiver listens for DataChannel from sender
      this.pc.ondatachannel = (event) => {
        this.dc = event.channel;
        this.dc.binaryType = 'arraybuffer';
        this.setupDataChannel(this.dc);
      };
    }
  }

  private async createAndSendOffer(): Promise<void> {
    if (!this.pc) return;

    this.setStatus('signaling');
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    this.sendSignaling('offer', { sdp: this.pc.localDescription });
  }

  private async handleOffer(
    payload: { sdp: RTCSessionDescriptionInit }
  ): Promise<void> {
    if (!this.pc) return;

    await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    this.sendSignaling('answer', { sdp: this.pc.localDescription });
  }

  private async handleAnswer(
    payload: { sdp: RTCSessionDescriptionInit }
  ): Promise<void> {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
  }

  private async handleIceCandidate(
    payload: { candidate: RTCIceCandidateInit }
  ): Promise<void> {
    if (!this.pc) return;
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch (err) {
      console.warn('Failed to add ICE candidate:', err);
    }
  }

  // ─────────────────────────────────────────────────
  // Data Channel
  // ─────────────────────────────────────────────────

  private setupDataChannel(dc: RTCDataChannel): void {
    dc.onopen = () => {
      this.setStatus('connected');
    };

    /** State machine for receiving: 'idle' → 'meta' → 'chunks' → 'done' */
    let receiveState: 'idle' | 'text-pending' | 'chunk-pending' = 'idle';

    dc.onmessage = async (event) => {
      // Binary data: encrypted chunk or text payload
      if (event.data instanceof ArrayBuffer) {
        if (receiveState === 'chunk-pending' && this.encryptionKey) {
          try {
            const decrypted = await decryptChunk(this.encryptionKey, event.data);
            this.receivedChunks.push(decrypted);
            this.totalTransferred += decrypted.byteLength;

            if (this.receivedMeta) {
              this.emitProgress(
                this.receivedMeta.fileSize,
                this.receivedMeta.fileName
              );
            }
          } catch (err) {
            this.events.onError?.(
              new Error('Decryption failed — data may have been tampered with.')
            );
          }
          receiveState = 'idle';
          return;
        }

        if (receiveState === 'text-pending' && this.encryptionKey) {
          try {
            const decrypted = await decryptChunk(this.encryptionKey, event.data);
            const text = new TextDecoder().decode(decrypted);
            this.events.onTextReceived?.(text);
            this.setStatus('done');
          } catch (err) {
            this.events.onError?.(
              new Error('Text decryption failed.')
            );
          }
          receiveState = 'idle';
          return;
        }
        return;
      }

      // String data: JSON control messages
      if (typeof event.data === 'string') {
        let msg: DataMessage;
        try {
          msg = JSON.parse(event.data) as DataMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'meta':
            this.receivedMeta = msg;
            this.receivedChunks = [];
            this.totalTransferred = 0;
            this.transferStartTime = Date.now();
            this.setStatus('transferring');
            break;

          case 'chunk':
            receiveState = 'chunk-pending';
            break;

          case 'text':
            receiveState = 'text-pending';
            break;

          case 'done':
            if (this.receivedMeta) {
              // Assemble file from decrypted chunks
              const blob = new Blob(this.receivedChunks, {
                type: this.receivedMeta.fileType,
              });
              this.events.onFileReceived?.(blob, this.receivedMeta);
              this.receivedChunks = [];
              this.receivedMeta = null;
              this.setStatus('done');
            }
            break;
        }
      }
    };

    dc.onerror = (event) => {
      this.setStatus('error');
      this.events.onError?.(new Error('DataChannel error.'));
    };

    dc.onclose = () => {
      if (this.status !== 'done' && this.status !== 'idle') {
        this.events.onPeerLeft?.();
      }
    };
  }

  // ─────────────────────────────────────────────────
  // Backpressure Control
  // ─────────────────────────────────────────────────

  /**
   * Wait for the DataChannel send buffer to drain below threshold.
   *
   * Prevents overwhelming the receiver when sending large files.
   * Monitors `bufferedAmount` and pauses until buffer drains.
   */
  private waitForBufferDrain(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.dc) {
        resolve();
        return;
      }

      if (this.dc.bufferedAmount < WebRTCManager.BUFFER_THRESHOLD) {
        resolve();
        return;
      }

      // Set low watermark for bufferedamountlow event
      this.dc.bufferedAmountLowThreshold = WebRTCManager.BUFFER_THRESHOLD / 2;
      this.dc.onbufferedamountlow = () => {
        if (this.dc) {
          this.dc.onbufferedamountlow = null;
        }
        resolve();
      };
    });
  }

  // ─────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────

  private sendSignaling(type: string, payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type,
        payload,
        ts: new Date().toISOString(),
      }));
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.events.onStatusChange?.(status);
  }

  private emitProgress(totalBytes: number, fileName?: string): void {
    const elapsed = (Date.now() - this.transferStartTime) / 1000;
    const speed = elapsed > 0 ? this.totalTransferred / elapsed : 0;

    this.events.onProgress?.({
      totalBytes,
      transferredBytes: this.totalTransferred,
      ratio: Math.min(this.totalTransferred / totalBytes, 1.0),
      speed,
      fileName,
    });
  }
}
