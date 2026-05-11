import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { nanoid } from 'nanoid';

// Re-export the Durable Object class so Wrangler can discover it
export { RoomCoordinator } from './room';

// ─────────────────────────────────────────────────
// Env Bindings (Cloudflare Workers)
// ─────────────────────────────────────────────────

// Env interface is declared globally for Durable Object access.
// See: worker-configuration.d.ts or inline below.

const app = new Hono<{ Bindings: Env }>();

// ─────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────

// CORS — allow all origins (QuickShare is a public tool)
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Upgrade', 'Connection'],
}));

// Security headers
app.use('*', secureHeaders());

// ─────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────

/**
 * GET / — Health check
 */
app.get('/', (c) => {
  return c.json({
    service: 'quickshare-signaling',
    status: 'healthy',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/room/new — Create a new room
 * Returns a unique room ID (8-character nanoid).
 */
app.get('/api/room/new', (c) => {
  const roomId = nanoid(8);

  return c.json({
    roomId,
    wsUrl: `/api/room/${roomId}/ws`,
  });
});

/**
 * GET /api/room/:roomId/ws — WebSocket upgrade to Durable Object
 *
 * This endpoint forwards the WebSocket upgrade request to the
 * RoomCoordinator Durable Object identified by the roomId.
 * The DO handles all signaling relay logic.
 */
app.get('/api/room/:roomId/ws', async (c) => {
  const roomId = c.req.param('roomId');

  // Validate room ID format (alphanumeric, 4-21 chars — nanoid range)
  if (!roomId || !/^[A-Za-z0-9_-]{4,21}$/.test(roomId)) {
    return c.json(
      { error: 'Invalid room ID format.' },
      { status: 400 }
    );
  }

  // Check for WebSocket upgrade header
  const upgradeHeader = c.req.header('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return c.json(
      { error: 'Expected WebSocket upgrade request.' },
      { status: 426 }
    );
  }

  // Get or create the Durable Object for this room
  const durableId = c.env.ROOM.idFromName(roomId);
  const roomStub = c.env.ROOM.get(durableId);

  // Forward the raw request to the Durable Object
  return roomStub.fetch(c.req.raw);
});

/**
 * GET /api/room/:roomId/info — Room status (optional diagnostic endpoint)
 */
app.get('/api/room/:roomId/info', (c) => {
  const roomId = c.req.param('roomId');

  return c.json({
    roomId,
    message: 'Room state is managed by Durable Objects. Connect via WebSocket to interact.',
  });
});

// ─────────────────────────────────────────────────
// 404 fallback
// ─────────────────────────────────────────────────

app.notFound((c) => {
  return c.json(
    { error: 'Not found', path: c.req.path },
    { status: 404 }
  );
});

// ─────────────────────────────────────────────────
// Error handler
// ─────────────────────────────────────────────────

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    { error: 'Internal server error' },
    { status: 500 }
  );
});

export default app;
