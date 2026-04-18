/**
 * auth.js — Express middleware for player and admin authentication
 *
 * Two protection levels:
 *   1. requirePlayer — any joined player with a valid token
 *   2. requireAdmin  — the teacher using the hardcoded ADMIN_KEY
 *
 * Tokens are sent in HTTP headers so they never appear in URLs.
 */

const { db } = require('./db');

// ---------------------------------------------------------------------------
// Player auth
// ---------------------------------------------------------------------------

/**
 * Middleware: verify the x-player-token header.
 *
 * On success, attaches `req.player` (the full DB row) so route handlers
 * don't have to look up the player themselves.
 */
function requirePlayer(req, res, next) {
  const token = req.headers['x-player-token'];

  if (!token) {
    return res.status(401).json({ error: 'Missing x-player-token header' });
  }

  const player = db.prepare('SELECT * FROM players WHERE token = ?').get(token);

  if (!player) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.player = player; // available downstream as req.player
  next();
}

// ---------------------------------------------------------------------------
// Admin auth
// ---------------------------------------------------------------------------

/**
 * Middleware: verify the x-admin-key header against ADMIN_KEY in .env.
 *
 * Intentionally simple — this is a classroom game, not a bank.
 * For a production system you'd use a proper auth library.
 */
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];

  if (!key) {
    return res.status(401).json({ error: 'Missing x-admin-key header' });
  }

  if (key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  next();
}

module.exports = { requirePlayer, requireAdmin };
