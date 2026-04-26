/**
 * game.js — Pure game-logic helpers (no Express, no DB)
 *
 * Keeping business logic here (separate from routes) makes it easy
 * for students to read, test, and modify the rules independently.
 */

// All tradeable goods in the game
const GOODS = ['fish', 'wood', 'cloth', 'grain', 'clay', 'metal', 'stone', 'wool', 'herbs', 'oil'];

// ---------------------------------------------------------------------------
// Inventory generation
// ---------------------------------------------------------------------------

/**
 * Generate a random starting inventory for one player.
 *
 * @param {number} maxQty  - Maximum units per good (one of 5, 10, 20, 100).
 *                           Controls the "richness" of the round.
 *
 * The min is set to ~40% of max so players always have something but
 * must still trade to reach their goals.
 *
 * Returns: { fish: 3, wood: 2, cloth: 4, grain: 2, clay: 3, ... }
 */
function randomInventory(maxQty = 5) {
  const minQty = Math.max(2, Math.floor(maxQty * 0.4));
  const inv = {};
  for (const good of GOODS) {
    inv[good] = randInt(minQty, maxQty);
  }
  return inv;
}

// ---------------------------------------------------------------------------
// Goal generation
// ---------------------------------------------------------------------------

/**
 * Generate a secret goal for a player given their starting inventory.
 *
 * Design constraints:
 *  - Goal covers 2–3 different goods
 *  - Each required quantity is 2–3 units
 *  - At least one required good is scarce in the player's inventory
 *    (qty < required), ensuring they must trade for it
 *
 * Students will read this to understand how "win conditions" work.
 */
function randomGoal(inventory) {
  // Shuffle goods so goals vary between players
  const shuffled = [...GOODS].sort(() => Math.random() - 0.5);

  // Pick 2–3 goods to be in the goal
  const goalSize  = randInt(2, 3);
  const goalGoods = shuffled.slice(0, goalSize);

  const goal = {};
  for (const good of goalGoods) {
    // Required = what the player currently has PLUS 1–2 more.
    // This guarantees the player is always short on every goal item
    // at the start of the round and must trade to meet their goal.
    goal[good] = (inventory[good] || 0) + randInt(1, 2);
  }

  return goal;
}

// ---------------------------------------------------------------------------
// Goal completion check
// ---------------------------------------------------------------------------

/**
 * Returns true if the player's inventory satisfies their goal.
 * A player "wins" when they hold at least the required quantity
 * of every goal item (extra goods are fine).
 */
function isGoalMet(inventory, goal) {
  return Object.entries(goal).every(
    ([good, required]) => (inventory[good] || 0) >= required
  );
}

// ---------------------------------------------------------------------------
// Trade validation
// ---------------------------------------------------------------------------

/**
 * Validate a trade offer before it is saved.
 *
 * Returns { ok: true } or { ok: false, error: '...' }.
 *
 * @param {object} fromInventory  - offerer's current inventory
 * @param {object} offer         - { item, qty, shells }
 * @param {object} toInventory   - receiver's current inventory
 * @param {object} request       - { item, qty, shells }
 * @param {boolean} currencyEnabled
 */
function validateTrade(fromInventory, offer, toInventory, request, currencyEnabled) {
  // --- offer side ---
  if (!GOODS.includes(offer.item) && !(offer.shells > 0 && currencyEnabled)) {
    return { ok: false, error: `Unknown good: "${offer.item}"` };
  }

  if (offer.item && GOODS.includes(offer.item)) {
    const available = fromInventory[offer.item] || 0;
    if (offer.qty < 1) {
      return { ok: false, error: 'offer.qty must be at least 1' };
    }
    if (available < offer.qty) {
      return { ok: false, error: `Offerer only has ${available} ${offer.item}` };
    }
  }

  // --- request side ---
  if (!GOODS.includes(request.item) && !(request.shells > 0 && currencyEnabled)) {
    return { ok: false, error: `Unknown good: "${request.item}"` };
  }

  if (request.item && GOODS.includes(request.item)) {
    const available = toInventory[request.item] || 0;
    if (request.qty < 1) {
      return { ok: false, error: 'request.qty must be at least 1' };
    }
    if (available < request.qty) {
      return { ok: false, error: `Receiver only has ${available} ${request.item}` };
    }
  }

  return { ok: true };
}

/**
 * Apply a completed trade: swap goods (and optionally shells) between
 * two inventories/balances.
 *
 * Mutates both inventory objects in place and returns updated balances.
 *
 * @param {object} fromInv     - offerer's inventory (mutated)
 * @param {number} fromBalance - offerer's shell balance
 * @param {object} offer       - { item, qty, shells }
 * @param {object} toInv       - receiver's inventory (mutated)
 * @param {number} toBalance   - receiver's shell balance
 * @param {object} request     - { item, qty, shells }
 * @returns {{ fromBalance: number, toBalance: number }}
 */
function applyTrade(fromInv, fromBalance, offer, toInv, toBalance, request) {
  // Offerer gives goods + shells to receiver
  if (offer.item && offer.qty > 0) {
    fromInv[offer.item]  = (fromInv[offer.item]  || 0) - offer.qty;
    toInv[offer.item]    = (toInv[offer.item]    || 0) + offer.qty;
  }
  if (offer.shells > 0) {
    fromBalance -= offer.shells;
    toBalance   += offer.shells;
  }

  // Receiver gives goods + shells back to offerer
  if (request.item && request.qty > 0) {
    toInv[request.item]   = (toInv[request.item]   || 0) - request.qty;
    fromInv[request.item] = (fromInv[request.item] || 0) + request.qty;
  }
  if (request.shells > 0) {
    toBalance   -= request.shells;
    fromBalance += request.shells;
  }

  return { fromBalance, toBalance };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Inclusive integer random in [min, max] */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
  GOODS,
  randomInventory,
  randomGoal,
  isGoalMet,
  validateTrade,
  applyTrade,
};
