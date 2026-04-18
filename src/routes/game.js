/**
 * routes/game.js — Public game state endpoint
 *
 * GET /game/state — returns the current round, currency status,
 *                   and a list of all active players (no secrets)
 *
 * No authentication required — the leaderboard is public.
 */

const express = require('express');
const { db, parseJSON } = require('../db');
const { isGoalMet } = require('../game');
const { connectedCount } = require('../websocket');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /game/state
// ---------------------------------------------------------------------------

/**
 * Public snapshot of the game world.
 *
 * Returns:
 * {
 *   round: 2,
 *   currencyEnabled: true,
 *   connectedPlayers: 12,
 *   players: [
 *     { id, name, goalMet, balance }   ← goals are NOT exposed here
 *   ]
 * }
 *
 * Students can use this to build a scoreboard that shows who has
 * met their secret goal (without revealing what the goal was).
 */
router.get('/state', (req, res) => {
  const state = db.prepare('SELECT * FROM game_state WHERE id = 1').get();

  const players = db.prepare('SELECT id, name, inventory, goal, balance FROM players').all();

  const playerSummaries = players.map(p => {
    const inventory = parseJSON(p.inventory);
    const goal      = parseJSON(p.goal);
    return {
      id:      p.id,
      name:    p.name,
      goalMet: isGoalMet(inventory, goal),
      balance: p.balance,
      // inventory is deliberately omitted — strategic information!
    };
  });

  res.json({
    round:            state.round,
    currencyEnabled:  state.currency_enabled === 1,
    connectedPlayers: connectedCount(),
    players:          playerSummaries,
  });
});

module.exports = router;
