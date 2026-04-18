# Barter Island 🪸

A classroom economics game server built with Node.js, Express, and WebSockets.

Players start with random inventories of goods and secret goals to collect.
They must trade with each other to meet their goals. Midway through, the teacher
introduces a shell currency — illustrating why money exists and how it solves the
**double coincidence of wants** problem inherent to barter.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env
# Edit .env and set ADMIN_KEY to something secret

# 3. Start the server
npm start
# or with auto-reload during development:
npm run dev
```

The server listens on `http://localhost:3000` (REST) and `ws://localhost:3000` (WebSocket).

---

## Project Structure

```
src/
├── index.js          # Entry point — wires Express + WS + DB together
├── db.js             # SQLite schema and connection
├── game.js           # Pure game logic (inventories, goals, trade math)
├── auth.js           # Player token and admin key middleware
├── websocket.js      # WS connection registry and broadcast helpers
└── routes/
    ├── player.js     # POST /player/join, GET /player/:id
    ├── trade.js      # trade offer / accept / decline / list
    ├── admin.js      # teacher controls (start-round, currency, events)
    └── game.js       # GET /game/state (public scoreboard)
```

---

## Authentication

| Header | Used for |
|---|---|
| `x-player-token` | Authenticate as a player (returned by `/player/join`) |
| `x-admin-key` | Authenticate as the teacher (set in `.env` as `ADMIN_KEY`) |

---

## REST API

### Player Endpoints

---

#### `POST /player/join`

Join the game. Returns a token you must use for all future requests.

**Request body:**
```json
{ "name": "Alice" }
```

**Response `201`:**
```json
{
  "playerId": "a1b2c3...",
  "token": "d4e5f6...",
  "inventory": { "fish": 3, "wood": 2, "cloth": 4, "grain": 2, "clay": 3 },
  "goal": { "cloth": 2, "grain": 3 }
}
```

> **Keep your token secret!** It's your identity in the game.

---

#### `GET /player/:id`

View your own inventory, goal, and shell balance.
Only works for your own player ID.

**Headers:** `x-player-token: <your-token>`

**Response `200`:**
```json
{
  "id": "a1b2c3...",
  "name": "Alice",
  "inventory": { "fish": 3, "wood": 2, "cloth": 4, "grain": 2, "clay": 3 },
  "goal": { "cloth": 2, "grain": 3 },
  "balance": 10,
  "goalMet": false
}
```

---

### Trade Endpoints

Goods: `fish`, `wood`, `cloth`, `grain`, `clay`

---

#### `POST /trade/offer`

Propose a trade to another player.

**Headers:** `x-player-token: <your-token>`

**Request body (barter):**
```json
{
  "fromId":  "your-player-id",
  "toId":    "target-player-id",
  "offer":   { "item": "fish", "qty": 2, "shells": 0 },
  "request": { "item": "wood", "qty": 1, "shells": 0 }
}
```

**Request body (with currency — only when currency is enabled):**
```json
{
  "fromId":  "your-player-id",
  "toId":    "target-player-id",
  "offer":   { "item": null, "qty": 0, "shells": 5 },
  "request": { "item": "cloth", "qty": 2, "shells": 0 }
}
```

**Response `201`:**
```json
{ "tradeId": "t1u2v3..." }
```

The target player receives a `trade_offer` WebSocket event.

---

#### `POST /trade/accept/:tradeId`

Accept a pending trade offer addressed to you.

**Headers:** `x-player-token: <your-token>`

Both players' inventories (and balances) are updated atomically.

**Response `200`:**
```json
{
  "message": "Trade accepted",
  "fromInventory": { "fish": 1, "wood": 3, "cloth": 4, "grain": 2, "clay": 3 },
  "toInventory":   { "fish": 5, "wood": 1, "cloth": 4, "grain": 2, "clay": 3 }
}
```

---

#### `POST /trade/decline/:tradeId`

Decline a pending trade offer.

**Headers:** `x-player-token: <your-token>`

**Response `200`:**
```json
{ "message": "Trade declined" }
```

---

#### `GET /trades/pending/:playerId`

List all pending trade offers waiting for your response.

**Headers:** `x-player-token: <your-token>`

**Response `200`:**
```json
{
  "trades": [
    {
      "tradeId": "t1u2v3...",
      "from": { "id": "a1b2c3...", "name": "Bob" },
      "offer":   { "item": "wood", "qty": 2, "shells": 0 },
      "request": { "item": "fish", "qty": 1, "shells": 0 },
      "createdAt": 1713400000
    }
  ]
}
```

---

### Admin Endpoints

All require `x-admin-key: <ADMIN_KEY>`.

---

#### `POST /admin/start-round`

Start a new round: randomises all inventories and goals, resets balances
to 0, cancels pending trades, and broadcasts `round_started`.

Run this at the beginning of each game phase.

**Response `200`:**
```json
{ "message": "Round 1 started", "round": 1, "playerCount": 15 }
```

---

#### `POST /admin/enable-currency`

Introduce shell currency. Every player receives 10 shells.
From this point on, trades may include `shells` on either side.

Broadcasts `currency_enabled` to all connected players.

**Response `200`:**
```json
{ "message": "Currency enabled", "startingBalance": 10 }
```

---

#### `POST /admin/trigger-event`

Broadcast a custom message to all connected players as a `game_event`.
Use this for narrative chaos moments.

**Request body:**
```json
{ "message": "Chaos! Nobody wants your fish. The fishing boats sank." }
```

**Response `200`:**
```json
{ "message": "Event broadcast", "text": "Chaos! Nobody wants your fish. The fishing boats sank." }
```

---

### Game State

#### `GET /game/state`

Public scoreboard. No authentication required.

**Response `200`:**
```json
{
  "round": 1,
  "currencyEnabled": false,
  "connectedPlayers": 12,
  "players": [
    { "id": "a1b2c3...", "name": "Alice", "goalMet": false, "balance": 0 },
    { "id": "d4e5f6...", "name": "Bob",   "goalMet": true,  "balance": 0 }
  ]
}
```

---

## WebSocket Events (Server → Client)

Connect to `ws://localhost:3000` and send an auth message first:

```json
{ "type": "auth", "token": "<your-player-token>" }
```

Server replies:
```json
{ "type": "auth_ok", "playerId": "a1b2c3..." }
```

---

| Event | When sent | Payload |
|---|---|---|
| `trade_offer` | Someone proposes a trade to you | `{ tradeId, from, offer, request }` |
| `trade_accepted` | A trade you're part of was accepted | `{ tradeId, offer, request, yourInventory, goalMet }` |
| `trade_declined` | Your outgoing offer was declined | `{ tradeId, declinedBy }` |
| `game_event` | Teacher broadcasts a chaos event | `{ message, timestamp }` |
| `currency_enabled` | Teacher enables shell currency | `{ message, startingBalance }` |
| `round_started` | Teacher starts a new round | `{ round, message }` |

---

## Example cURL Commands

```bash
# Join the game
curl -s -X POST http://localhost:3000/player/join \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice"}'

# View your inventory (replace IDs/token with your own)
curl -s http://localhost:3000/player/PLAYER_ID \
  -H "x-player-token: YOUR_TOKEN"

# Propose a trade (give 2 fish, want 1 wood)
curl -s -X POST http://localhost:3000/trade/offer \
  -H "Content-Type: application/json" \
  -H "x-player-token: YOUR_TOKEN" \
  -d '{
    "fromId":  "YOUR_ID",
    "toId":    "BOB_ID",
    "offer":   { "item": "fish", "qty": 2, "shells": 0 },
    "request": { "item": "wood", "qty": 1, "shells": 0 }
  }'

# Accept a trade
curl -s -X POST http://localhost:3000/trade/accept/TRADE_ID \
  -H "x-player-token: YOUR_TOKEN"

# Decline a trade
curl -s -X POST http://localhost:3000/trade/decline/TRADE_ID \
  -H "x-player-token: YOUR_TOKEN"

# Check your pending trades
curl -s http://localhost:3000/trades/pending/PLAYER_ID \
  -H "x-player-token: YOUR_TOKEN"

# View the scoreboard (no auth needed)
curl -s http://localhost:3000/game/state

# --- Teacher commands ---

# Start a new round
curl -s -X POST http://localhost:3000/admin/start-round \
  -H "x-admin-key: barter-teacher-secret"

# Enable currency
curl -s -X POST http://localhost:3000/admin/enable-currency \
  -H "x-admin-key: barter-teacher-secret"

# Trigger a chaos event
curl -s -X POST http://localhost:3000/admin/trigger-event \
  -H "Content-Type: application/json" \
  -H "x-admin-key: barter-teacher-secret" \
  -d '{"message": "Chaos! Nobody wants your fish!"}'
```

---

## Minimal HTML Client

Save this as `client.html`, open it in a browser, and enter your player ID and token.
It shows your inventory, lets you view pending trades, and receives live WebSocket events.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Barter Island</title>
  <style>
    body { font-family: monospace; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
    pre  { background: #f4f4f4; padding: 1rem; border-radius: 4px; overflow-x: auto; }
    button { margin: .25rem; padding: .4rem .8rem; cursor: pointer; }
    input  { padding: .4rem; width: 100%; box-sizing: border-box; margin-bottom: .5rem; }
    #events { height: 200px; overflow-y: auto; background: #1a1a2e; color: #0ff;
              padding: 1rem; border-radius: 4px; font-size: .85rem; }
  </style>
</head>
<body>
  <h1>🪸 Barter Island</h1>

  <h2>Connect</h2>
  <label>Server URL <input id="serverUrl" value="http://localhost:3000"></label>
  <label>Player ID  <input id="playerId"  placeholder="paste your playerId here"></label>
  <label>Token      <input id="token"     placeholder="paste your token here"></label>
  <button onclick="connect()">Connect</button>

  <h2>My State</h2>
  <button onclick="fetchState()">Refresh</button>
  <pre id="state">—</pre>

  <h2>Pending Trades</h2>
  <button onclick="fetchPending()">Refresh</button>
  <pre id="pending">—</pre>

  <h2>Accept / Decline a Trade</h2>
  <label>Trade ID <input id="tradeId" placeholder="paste tradeId here"></label>
  <button onclick="respondTrade('accept')">Accept</button>
  <button onclick="respondTrade('decline')">Decline</button>

  <h2>Live Events</h2>
  <div id="events"></div>

  <script>
    let ws = null;

    function getBase() { return document.getElementById('serverUrl').value.trim(); }
    function getPlayerId() { return document.getElementById('playerId').value.trim(); }
    function getToken()    { return document.getElementById('token').value.trim(); }

    function logEvent(msg) {
      const div = document.getElementById('events');
      div.textContent += new Date().toLocaleTimeString() + ' — ' + msg + '\n';
      div.scrollTop = div.scrollHeight;
    }

    // Open WebSocket and authenticate
    function connect() {
      if (ws) ws.close();
      const wsUrl = getBase().replace(/^http/, 'ws');
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', token: getToken() }));
        logEvent('WebSocket connected');
      };

      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        logEvent(JSON.stringify(data));

        // Auto-refresh state when inventory changes
        if (['trade_accepted', 'round_started', 'currency_enabled'].includes(data.type)) {
          fetchState();
        }
      };

      ws.onclose  = () => logEvent('WebSocket disconnected');
      ws.onerror  = () => logEvent('WebSocket error');
    }

    // GET /player/:id
    async function fetchState() {
      const r = await fetch(`${getBase()}/player/${getPlayerId()}`, {
        headers: { 'x-player-token': getToken() }
      });
      document.getElementById('state').textContent = JSON.stringify(await r.json(), null, 2);
    }

    // GET /trades/pending/:playerId
    async function fetchPending() {
      const r = await fetch(`${getBase()}/trades/pending/${getPlayerId()}`, {
        headers: { 'x-player-token': getToken() }
      });
      document.getElementById('pending').textContent = JSON.stringify(await r.json(), null, 2);
    }

    // POST /trade/accept|decline/:tradeId
    async function respondTrade(action) {
      const tradeId = document.getElementById('tradeId').value.trim();
      if (!tradeId) { alert('Enter a trade ID first'); return; }
      const r = await fetch(`${getBase()}/trade/${action}/${tradeId}`, {
        method: 'POST',
        headers: { 'x-player-token': getToken() }
      });
      const data = await r.json();
      logEvent(`${action} → ${JSON.stringify(data)}`);
      fetchPending();
    }
  </script>
</body>
</html>
```

---

## Game Flow

```
1. Teacher: POST /admin/start-round
   → All players get randomised inventories and secret goals

2. Players: POST /player/join (if not already joined)
   → Save your token!

3. Players: GET /player/:id
   → Read your inventory and goal

4. Players negotiate and trade via:
   → POST /trade/offer
   → POST /trade/accept / decline

5. Teacher watches the chaos, then:
   → POST /admin/trigger-event  { "message": "Nobody can agree on prices!" }

6. Class votes to use money. Teacher:
   → POST /admin/enable-currency
   → All players receive 10 shells

7. Trading continues — now with money in the mix.

8. GET /game/state shows who has met their goal (goalMet: true)
```

---

## Key Concepts Illustrated

| Concept | Where in the code |
|---|---|
| Double coincidence of wants | Players struggle to find mutually agreeable barter trades |
| Medium of exchange | `balance` field + `shells` in trade offers |
| Unit of account | Shell quantities in trade payloads |
| Store of value | Balances persist across trades |
| Divisibility | Shells can be paid in any amount |
| Token auth | `src/auth.js` |
| Atomic transactions | `db.transaction()` in `routes/trade.js` |
| Real-time events | `src/websocket.js` broadcast helpers |
