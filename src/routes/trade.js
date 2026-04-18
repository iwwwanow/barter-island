/**
 * routes/trade.js — Trade proposal, acceptance, and rejection
 *
 * POST /trade/offer              — propose a trade to another player
 * POST /trade/accept/:tradeId    — accept an incoming trade offer
 * POST /trade/decline/:tradeId   — decline an incoming trade offer
 * GET  /trades/pending/:playerId — list offers waiting for your response
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db, parseJSON, toJSON } = require('../db');
const { requirePlayer } = require('../auth');
const { validateTrade, applyTrade, isGoalMet } = require('../game');
const { sendToPlayer } = require('../websocket');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read current game state (currency enabled?) */
function getGameState() {
  return db.prepare('SELECT * FROM game_state WHERE id = 1').get();
}

/** Normalise an offer/request object coming from the client */
function normaliseSide(side = {}) {
  return {
    item:   side.item   || null,
    qty:    Number(side.qty)    || 0,
    shells: Number(side.shells) || 0,
  };
}

// ---------------------------------------------------------------------------
// POST /trade/offer
// ---------------------------------------------------------------------------

/**
 * Propose a trade.
 *
 * Body: {
 *   fromId:  "uuid-of-proposer",
 *   toId:    "uuid-of-target",
 *   offer:   { item: "fish",  qty: 2, shells: 0 },
 *   request: { item: "wood",  qty: 1, shells: 0 }
 * }
 *
 * When currency is enabled you may include shells on either side, e.g.:
 *   offer:   { item: null, qty: 0, shells: 5 }  — pay 5 shells, ask for goods
 *
 * Returns: { tradeId }
 * WS event sent to target player: trade_offer
 */
router.post('/offer', requirePlayer, (req, res) => {
  const { fromId, toId, offer: rawOffer, request: rawRequest } = req.body;

  // Authorisation: you can only offer trades from yourself
  if (req.player.id !== fromId) {
    return res.status(403).json({ error: 'fromId must match your player id' });
  }

  if (fromId === toId) {
    return res.status(400).json({ error: 'Cannot trade with yourself' });
  }

  const offer   = normaliseSide(rawOffer);
  const request = normaliseSide(rawRequest);

  // Fetch both players
  const fromPlayer = db.prepare('SELECT * FROM players WHERE id = ?').get(fromId);
  const toPlayer   = db.prepare('SELECT * FROM players WHERE id = ?').get(toId);

  if (!toPlayer) {
    return res.status(404).json({ error: 'Target player not found' });
  }

  const gameState = getGameState();
  const currencyEnabled = gameState.currency_enabled === 1;

  // Validate shell usage
  if (!currencyEnabled && (offer.shells > 0 || request.shells > 0)) {
    return res.status(400).json({ error: 'Currency not yet enabled' });
  }
  if (currencyEnabled && offer.shells > 0 && fromPlayer.balance < offer.shells) {
    return res.status(400).json({
      error: `You only have ${fromPlayer.balance} shells`,
    });
  }

  const fromInventory = parseJSON(fromPlayer.inventory);
  const toInventory   = parseJSON(toPlayer.inventory);

  // Run game-logic validation
  const validation = validateTrade(
    fromInventory, offer,
    toInventory,   request,
    currencyEnabled,
  );

  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  // Persist the trade offer
  const tradeId = uuidv4();

  db.prepare(`
    INSERT INTO trades (id, from_id, to_id, offer, request, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(tradeId, fromId, toId, toJSON(offer), toJSON(request));

  // Notify the target player via WebSocket (if they're connected)
  sendToPlayer(toId, 'trade_offer', {
    tradeId,
    from:    { id: fromPlayer.id, name: fromPlayer.name },
    offer,
    request,
  });

  res.status(201).json({ tradeId });
});

// ---------------------------------------------------------------------------
// POST /trade/accept/:tradeId
// ---------------------------------------------------------------------------

/**
 * Accept a pending trade offer.
 *
 * Both inventories (and balances, if currency is enabled) are updated
 * atomically inside a SQLite transaction.
 *
 * WS events: trade_accepted sent to both players
 */
router.post('/accept/:tradeId', requirePlayer, (req, res) => {
  const { tradeId } = req.params;

  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);

  if (!trade) {
    return res.status(404).json({ error: 'Trade not found' });
  }
  if (trade.status !== 'pending') {
    return res.status(400).json({ error: `Trade is already ${trade.status}` });
  }
  if (trade.to_id !== req.player.id) {
    return res.status(403).json({ error: 'Only the recipient can accept a trade' });
  }

  const fromPlayer = db.prepare('SELECT * FROM players WHERE id = ?').get(trade.from_id);
  const toPlayer   = req.player; // already fetched by requirePlayer

  const offer   = parseJSON(trade.offer);
  const request = parseJSON(trade.request);

  const fromInv = parseJSON(fromPlayer.inventory);
  const toInv   = parseJSON(toPlayer.inventory);

  // Re-validate at accept time (inventory may have changed since offer was made)
  const gameState = getGameState();
  const currencyEnabled = gameState.currency_enabled === 1;
  const validation = validateTrade(fromInv, offer, toInv, request, currencyEnabled);
  if (!validation.ok) {
    return res.status(400).json({
      error: `Trade is no longer valid: ${validation.error}`,
    });
  }

  // Apply the swap
  const { fromBalance, toBalance } = applyTrade(
    fromInv, fromPlayer.balance,
    offer,
    toInv,   toPlayer.balance,
    request,
  );

  // Commit everything in one transaction so we never get partial updates
  const commit = db.transaction(() => {
    db.prepare(`UPDATE players SET inventory = ?, balance = ? WHERE id = ?`)
      .run(toJSON(fromInv), fromBalance, fromPlayer.id);

    db.prepare(`UPDATE players SET inventory = ?, balance = ? WHERE id = ?`)
      .run(toJSON(toInv), toBalance, toPlayer.id);

    db.prepare(`UPDATE trades SET status = 'accepted' WHERE id = ?`)
      .run(tradeId);
  });
  commit();

  // Check goal completion
  const fromGoal = parseJSON(fromPlayer.goal);
  const toGoal   = parseJSON(toPlayer.goal);

  const event = {
    tradeId,
    offer,
    request,
    fromInventory: fromInv,
    toInventory:   toInv,
  };

  sendToPlayer(fromPlayer.id, 'trade_accepted', {
    ...event,
    yourInventory: fromInv,
    goalMet: isGoalMet(fromInv, fromGoal),
  });
  sendToPlayer(toPlayer.id, 'trade_accepted', {
    ...event,
    yourInventory: toInv,
    goalMet: isGoalMet(toInv, toGoal),
  });

  res.json({ message: 'Trade accepted', fromInventory: fromInv, toInventory: toInv });
});

// ---------------------------------------------------------------------------
// POST /trade/decline/:tradeId
// ---------------------------------------------------------------------------

/**
 * Decline a pending trade offer.
 *
 * WS event: trade_declined sent to the original proposer
 */
router.post('/decline/:tradeId', requirePlayer, (req, res) => {
  const { tradeId } = req.params;

  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);

  if (!trade) {
    return res.status(404).json({ error: 'Trade not found' });
  }
  if (trade.status !== 'pending') {
    return res.status(400).json({ error: `Trade is already ${trade.status}` });
  }
  if (trade.to_id !== req.player.id) {
    return res.status(403).json({ error: 'Only the recipient can decline a trade' });
  }

  db.prepare(`UPDATE trades SET status = 'declined' WHERE id = ?`).run(tradeId);

  sendToPlayer(trade.from_id, 'trade_declined', {
    tradeId,
    declinedBy: { id: req.player.id, name: req.player.name },
  });

  res.json({ message: 'Trade declined' });
});

// ---------------------------------------------------------------------------
// GET /trades/pending/:playerId
// ---------------------------------------------------------------------------

/**
 * List all pending trade offers addressed to a player.
 *
 * Useful for polling if the student hasn't connected via WebSocket yet.
 */
router.get('/pending/:playerId', requirePlayer, (req, res) => {
  const { playerId } = req.params;

  if (req.player.id !== playerId) {
    return res.status(403).json({ error: 'You can only view your own pending trades' });
  }

  const rows = db.prepare(`
    SELECT t.*, p.name AS from_name
    FROM   trades  t
    JOIN   players p ON p.id = t.from_id
    WHERE  t.to_id = ? AND t.status = 'pending'
    ORDER  BY t.created_at ASC
  `).all(playerId);

  const trades = rows.map(row => ({
    tradeId:    row.id,
    from:       { id: row.from_id, name: row.from_name },
    offer:      parseJSON(row.offer),
    request:    parseJSON(row.request),
    createdAt:  row.created_at,
  }));

  res.json({ trades });
});

module.exports = router;
