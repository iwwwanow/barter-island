/**
 * routes/admin.js — Teacher-only game control endpoints
 *
 * All routes here require the x-admin-key header.
 *
 * POST /admin/start-round      — wipe state, deal new inventories
 * POST /admin/enable-currency  — introduce shell currency mid-game
 * POST /admin/trigger-event    — broadcast a chaos message to all players
 */

const express = require('express');
const { db, parseJSON, toJSON } = require('../db');
const { requireAdmin } = require('../auth');
const { randomInventory, randomGoal } = require('../game');
const { broadcast } = require('../websocket');

const router = express.Router();

// All admin routes require the admin key
router.use(requireAdmin);

// ---------------------------------------------------------------------------
// POST /admin/start-round
// ---------------------------------------------------------------------------

/**
 * Start a new round:
 *  1. Increment the round counter
 *  2. Re-randomise every player's inventory and goal
 *  3. Cancel all pending trades (they're stale now)
 *  4. Reset shell balances to 0
 *  5. Broadcast `round_started` to all connected players
 *
 * This lets the teacher run multiple rounds in a single session
 * (e.g., barter round → then currency round).
 */
router.post('/start-round', (req, res) => {
  const players = db.prepare('SELECT * FROM players').all();

  if (players.length === 0) {
    return res.status(400).json({ error: 'No players have joined yet' });
  }

  // Validate optional resourceQty parameter (must be one of the allowed presets)
  const ALLOWED_QTY = [5, 10, 20, 100];
  const bodyQty = Number(req.body?.resourceQty);
  const resourceQty = ALLOWED_QTY.includes(bodyQty) ? bodyQty : null;

  // Atomically update everyone
  const startRound = db.transaction(() => {
    // Persist resourceQty if provided; otherwise keep whatever is stored
    if (resourceQty !== null) {
      db.prepare(`UPDATE game_state SET resource_qty = ? WHERE id = 1`).run(resourceQty);
    }

    const { resource_qty } = db.prepare('SELECT resource_qty FROM game_state WHERE id = 1').get();

    for (const player of players) {
      const inventory = randomInventory(resource_qty);
      const goal      = randomGoal(inventory);

      db.prepare(`
        UPDATE players SET inventory = ?, goal = ?, balance = 0 WHERE id = ?
      `).run(toJSON(inventory), toJSON(goal), player.id);
    }

    // Cancel lingering offers so the trade list is clean
    db.prepare(`UPDATE trades SET status = 'declined' WHERE status = 'pending'`).run();

    // Advance the round counter; reset currency_enabled for a fresh barter round
    db.prepare(`
      UPDATE game_state
      SET round = round + 1,
          currency_enabled = 0,
          started_at = strftime('%s','now')
      WHERE id = 1
    `).run();
  });
  startRound();

  const state = db.prepare('SELECT * FROM game_state WHERE id = 1').get();

  // Push to all connected players — their UI should re-fetch /player/:id
  broadcast('round_started', {
    round: state.round,
    message: `Round ${state.round} has begun! Check your new inventory.`,
  });

  res.json({
    message:    `Round ${state.round} started`,
    round:      state.round,
    playerCount: players.length,
  });
});

// ---------------------------------------------------------------------------
// POST /admin/enable-currency
// ---------------------------------------------------------------------------

/**
 * Enable shell currency mid-game.
 *
 * Each player receives 10 shells. From this point on, shells can be
 * included in trade offers (the `shells` field).
 *
 * Broadcasts `currency_enabled` so clients can update their UI.
 */
router.post('/enable-currency', (req, res) => {
  const state = db.prepare('SELECT * FROM game_state WHERE id = 1').get();

  if (state.currency_enabled) {
    return res.status(400).json({ error: 'Currency is already enabled' });
  }
  if (state.round === 0) {
    return res.status(400).json({ error: 'Start a round first' });
  }

  const STARTING_SHELLS = 10;

  const enable = db.transaction(() => {
    db.prepare(`UPDATE game_state SET currency_enabled = 1 WHERE id = 1`).run();
    db.prepare(`UPDATE players SET balance = ?`).run(STARTING_SHELLS);
  });
  enable();

  broadcast('currency_enabled', {
    message: `The village has agreed to use shells as money! Everyone starts with ${STARTING_SHELLS} shells.`,
    startingBalance: STARTING_SHELLS,
  });

  res.json({
    message:         'Currency enabled',
    startingBalance: STARTING_SHELLS,
  });
});

// ---------------------------------------------------------------------------
// POST /admin/trigger-event
// ---------------------------------------------------------------------------

/**
 * Broadcast an arbitrary game event to all connected players.
 *
 * Body: { "message": "Chaos! A storm destroyed all the fish in the market!" }
 *
 * Use this to simulate economic shocks, introduce the currency story beat,
 * or just mess with the students.
 */
router.post('/trigger-event', (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'message is required' });
  }

  broadcast('game_event', {
    message: message.trim(),
    timestamp: Date.now(),
  });

  res.json({ message: 'Event broadcast', text: message.trim() });
});

// ---------------------------------------------------------------------------
// POST /admin/reset
// ---------------------------------------------------------------------------

/**
 * Полный сброс игры: удаляет всех игроков, все сделки,
 * обнуляет счётчик раундов и флаг валюты.
 *
 * Используй между занятиями или когда нужно начать с чистого листа.
 * Требует подтверждения в теле запроса: { "confirm": "yes" }
 */
router.post('/reset', (req, res) => {
  if (req.body?.confirm !== 'yes') {
    return res.status(400).json({
      error: 'Добавь { "confirm": "yes" } в тело запроса для подтверждения',
    });
  }

  const reset = db.transaction(() => {
    db.prepare('DELETE FROM trades').run();
    db.prepare('DELETE FROM players').run();
    db.prepare('UPDATE game_state SET round = 0, currency_enabled = 0, started_at = NULL WHERE id = 1').run();
  });
  reset();

  broadcast('game_event', {
    message: 'Сервер сброшен. Войдите заново через /player/join.',
  });

  res.json({ message: 'Игра полностью сброшена' });
});

// ---------------------------------------------------------------------------
// GET /admin/players
// ---------------------------------------------------------------------------

/**
 * Full player list for the teacher dashboard — includes secret goals
 * and complete inventories that are hidden from /game/state.
 */
router.get('/players', (req, res) => {
  const { parseJSON: pj, isGoalMet: igm } = (() => {
    const { parseJSON } = require('../db');
    const { isGoalMet } = require('../game');
    return { parseJSON, isGoalMet };
  })();

  const players = db.prepare('SELECT * FROM players').all();

  const result = players.map(p => {
    const inventory = pj(p.inventory);
    const goal      = pj(p.goal);
    return {
      id:        p.id,
      name:      p.name,
      inventory,
      goal,
      balance:   p.balance,
      goalMet:   igm(inventory, goal),
    };
  });

  res.json({ players: result });
});

// ---------------------------------------------------------------------------
// GET /admin/trades
// ---------------------------------------------------------------------------

/**
 * All trades (all statuses) for the teacher dashboard.
 * Useful to see trading activity at a glance.
 */
router.get('/trades', (req, res) => {
  const { parseJSON } = require('../db');

  const rows = db.prepare(`
    SELECT t.*,
           f.name AS from_name,
           tt.name AS to_name
    FROM   trades t
    JOIN   players f  ON f.id  = t.from_id
    JOIN   players tt ON tt.id = t.to_id
    ORDER  BY t.created_at DESC
    LIMIT  100
  `).all();

  const trades = rows.map(r => ({
    tradeId:   r.id,
    status:    r.status,
    from:      { id: r.from_id, name: r.from_name },
    to:        { id: r.to_id,   name: r.to_name   },
    offer:     parseJSON(r.offer),
    request:   parseJSON(r.request),
    createdAt: r.created_at,
  }));

  res.json({ trades });
});

module.exports = router;
