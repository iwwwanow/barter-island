/**
 * routes/player.js — Player registration and profile
 *
 * POST /player/join   — join the game, receive a token
 * GET  /player/:id    — view your inventory, goal, and balance
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db, parseJSON, toJSON } = require('../db');
const { requirePlayer } = require('../auth');
const { randomInventory, randomGoal, isGoalMet } = require('../game');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /player/join
// ---------------------------------------------------------------------------

/**
 * Register a new player.
 *
 * Body:   { "name": "Alice" }
 * Returns: { playerId, token, inventory, goal }
 *
 * The token must be sent as the x-player-token header on all subsequent
 * authenticated requests.
 */
router.post('/join', (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'name is required' });
  }

  const cleanName = name.trim().slice(0, 32); // max 32 chars

  // Prevent duplicate names (makes the classroom less confusing)
  const existing = db.prepare('SELECT id FROM players WHERE name = ?').get(cleanName);
  if (existing) {
    return res.status(409).json({ error: `Name "${cleanName}" is already taken` });
  }

  const playerId = uuidv4();
  const token    = uuidv4(); // simple random token

  // Generate random starting position
  const inventory = randomInventory();
  const goal      = randomGoal(inventory); // may adjust inventory to guarantee a deficit

  db.prepare(`
    INSERT INTO players (id, name, token, inventory, goal, balance)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(playerId, cleanName, token, toJSON(inventory), toJSON(goal));

  res.status(201).json({
    playerId,
    token,       // store this — you'll need it for every request!
    inventory,
    goal,        // keep this secret from other players
  });
});

// ---------------------------------------------------------------------------
// GET /player/:id
// ---------------------------------------------------------------------------

/**
 * Fetch a player's full state.
 *
 * Requires x-player-token. Players can only view their own profile.
 *
 * Returns: { id, name, inventory, goal, balance, goalMet }
 */
router.get('/:id', requirePlayer, (req, res) => {
  const { id } = req.params;

  // Players can only see their own data (goals are secret!)
  if (req.player.id !== id) {
    return res.status(403).json({ error: 'You can only view your own profile' });
  }

  const inventory = parseJSON(req.player.inventory);
  const goal      = parseJSON(req.player.goal);

  res.json({
    id:       req.player.id,
    name:     req.player.name,
    inventory,
    goal,
    balance:  req.player.balance,
    goalMet:  isGoalMet(inventory, goal),
  });
});

module.exports = router;
