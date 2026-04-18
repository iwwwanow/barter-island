/**
 * db.js — Database setup and helper utilities
 *
 * We use better-sqlite3, a synchronous SQLite driver. Synchronous DB calls
 * are fine here: our server handles ~15 students and synchronous code is
 * much easier to read and reason about than callbacks or async/await chains.
 */

const Database = require('better-sqlite3');
const path     = require('path');

// Resolve the DB path from the environment variable (set in .env)
const DB_PATH = path.resolve(process.env.DB_PATH || './barter.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

db.exec(`
  -- One row per joined player
  CREATE TABLE IF NOT EXISTS players (
    id         TEXT PRIMARY KEY,          -- UUID
    name       TEXT NOT NULL,
    token      TEXT NOT NULL UNIQUE,      -- auth token sent in x-player-token header
    inventory  TEXT NOT NULL DEFAULT '{}',-- JSON: { fish: 3, wood: 2, ... }
    goal       TEXT NOT NULL DEFAULT '{}',-- JSON: { cloth: 2, grain: 1, ... }
    balance    INTEGER NOT NULL DEFAULT 0 -- shell currency (0 until currency enabled)
  );

  -- One row per trade proposal
  CREATE TABLE IF NOT EXISTS trades (
    id         TEXT PRIMARY KEY,
    from_id    TEXT NOT NULL,             -- proposing player
    to_id      TEXT NOT NULL,             -- receiving player
    offer      TEXT NOT NULL,             -- JSON: { item: 'fish', qty: 2, shells: 0 }
    request    TEXT NOT NULL,             -- JSON: { item: 'wood', qty: 1, shells: 0 }
    status     TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (from_id) REFERENCES players(id),
    FOREIGN KEY (to_id)   REFERENCES players(id)
  );

  -- Single-row table that holds global game state
  CREATE TABLE IF NOT EXISTS game_state (
    id                INTEGER PRIMARY KEY CHECK (id = 1), -- enforces single row
    round             INTEGER NOT NULL DEFAULT 0,
    currency_enabled  INTEGER NOT NULL DEFAULT 0,         -- 0 = false, 1 = true
    started_at        INTEGER
  );

  -- Seed the single game_state row if it doesn't exist yet
  INSERT OR IGNORE INTO game_state (id, round, currency_enabled)
  VALUES (1, 0, 0);
`);

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/**
 * Parse a JSON column that was stored as a string.
 * Returns a plain object; returns {} on any error.
 */
function parseJSON(str) {
  try { return JSON.parse(str); }
  catch { return {}; }
}

/**
 * Serialize an object to a JSON string for storage.
 */
function toJSON(obj) {
  return JSON.stringify(obj);
}

module.exports = { db, parseJSON, toJSON };
