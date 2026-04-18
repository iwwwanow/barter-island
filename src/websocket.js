/**
 * websocket.js — WebSocket connection registry and broadcast helpers
 *
 * We use the bare `ws` library (not socket.io) so students can see
 * exactly what goes over the wire — plain JSON text frames.
 *
 * Architecture:
 *   - A Map tracks which WebSocket connection belongs to which playerId
 *   - Route handlers call send() / broadcast() to push events
 *   - Clients authenticate by sending { type: 'auth', token: '...' }
 *     as their very first message after connecting
 */

const { db } = require('./db');

// playerId → WebSocket instance
const connections = new Map();

// ---------------------------------------------------------------------------
// Attach WebSocket handling to an existing http.Server
// ---------------------------------------------------------------------------

/**
 * @param {import('ws').WebSocketServer} wss
 */
function initWebSocket(wss) {
  wss.on('connection', (ws) => {
    // Each connection starts unauthenticated
    ws.playerId = null;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
        return;
      }

      // The only message clients need to send is the auth handshake.
      // Everything else is driven by REST calls; WS is server → client only.
      if (msg.type === 'auth') {
        const player = db.prepare('SELECT id FROM players WHERE token = ?').get(msg.token);
        if (!player) {
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid token' }));
          return;
        }

        ws.playerId = player.id;
        connections.set(player.id, ws);

        ws.send(JSON.stringify({ type: 'auth_ok', playerId: player.id }));
      }
    });

    ws.on('close', () => {
      if (ws.playerId) {
        connections.delete(ws.playerId);
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] error:', err.message);
    });
  });
}

// ---------------------------------------------------------------------------
// Sending helpers
// ---------------------------------------------------------------------------

/**
 * Send a typed event to one specific player (if they're connected).
 *
 * @param {string} playerId
 * @param {string} type     - event name, e.g. 'trade_offer'
 * @param {object} payload  - any extra data to include
 */
function sendToPlayer(playerId, type, payload = {}) {
  const ws = connections.get(playerId);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

/**
 * Broadcast a typed event to every connected player.
 *
 * @param {string} type
 * @param {object} payload
 */
function broadcast(type, payload = {}) {
  const msg = JSON.stringify({ type, ...payload });
  for (const ws of connections.values()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(msg);
    }
  }
}

/**
 * How many players are currently connected via WebSocket.
 */
function connectedCount() {
  return connections.size;
}

module.exports = { initWebSocket, sendToPlayer, broadcast, connectedCount };
