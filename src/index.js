/**
 * index.js — Barter Island server entry point
 *
 * Wires together:
 *   - Express (REST API)
 *   - ws (WebSocket server on the same port)
 *   - better-sqlite3 (initialised by importing db.js)
 *   - dotenv (loads .env before anything else)
 */

// Load environment variables from .env FIRST, before any other imports
require('dotenv').config();

const http      = require('http');
const path      = require('path');
const express   = require('express');
const { WebSocketServer } = require('ws');

// DB import runs the CREATE TABLE migrations on startup
require('./db');

const { initWebSocket } = require('./websocket');

// Route modules
const playerRoutes = require('./routes/player');
const tradeRoutes  = require('./routes/trade');
const adminRoutes  = require('./routes/admin');
const gameRoutes   = require('./routes/game');

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// ---------------------------------------------------------------------------
// CORS — allow requests from any origin (file://, localhost, LAN IPs, ngrok)
// This is intentional: students open HTML files directly from disk and connect
// to the server, so we can't predict the exact origin.
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-player-token, x-admin-key');

  // Browsers send a preflight OPTIONS request before POST with custom headers.
  // Respond immediately with 204 No Content — no need to hit any route logic.
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// Parse JSON bodies on all requests
app.use(express.json());

// Simple request logger — helpful for students watching the terminal
app.use((req, _res, next) => {
  if (req.method !== 'OPTIONS') console.log(`[HTTP] ${req.method} ${req.path}`);
  next();
});

// Serve HTML clients directly so they open via http://, not file://
// file:// origins are blocked by browsers when making fetch requests
const ROOT = path.join(__dirname, '..');
app.get('/',          (_req, res) => res.sendFile(path.join(ROOT, 'client.html')));
app.get('/dashboard', (_req, res) => res.sendFile(path.join(ROOT, 'dashboard.html')));

// Mount routers
app.use('/player',  playerRoutes);
app.use('/trade',   tradeRoutes);
app.use('/trades',  tradeRoutes); // same router handles GET /trades/pending/:id
app.use('/admin',   adminRoutes);
app.use('/game',    gameRoutes);

// Health check — useful to confirm the server is alive
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler — catches any unhandled throw in a route
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// HTTP server + WebSocket server (share the same port)
// ---------------------------------------------------------------------------

const PORT   = process.env.PORT || 3000;
const server = http.createServer(app);

// The WebSocket server piggybacks on the same http.Server.
// Clients connect to ws://localhost:3000 (no extra port needed).
const wss = new WebSocketServer({ server });
initWebSocket(wss);

server.listen(PORT, () => {
  console.log(`\n🪸  Barter Island server running`);
  console.log(`    REST API  → http://localhost:${PORT}`);
  console.log(`    WebSocket → ws://localhost:${PORT}`);
  console.log(`    Admin key → ${process.env.ADMIN_KEY}\n`);
});
