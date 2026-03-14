# Neon Syndicate — Plan 4: WebSocket + Dashboard Design Spec
**Date:** 2026-03-14
**Status:** Approved

---

## Overview

Add a live spectator dashboard to Neon Syndicate. After each tick, the server broadcasts world state to all connected WebSocket clients. A single-page dashboard displays the city map as an interactive node graph, a floating leaderboard, an active law banner, and a scrolling headline ticker — all updating in real time.

---

## Core Design Decisions

| Dimension | Decision |
|---|---|
| WebSocket library | `ws` npm package, attached to same `http.Server` as Express |
| WebSocket path | `ws://host/ws` — no auth for spectators |
| Dashboard | Single `public/index.html` — vanilla JS + D3.js via CDN, no build step |
| Map style | SVG node graph, pan/zoom via `d3.zoom()`, force-directed layout client-side |
| Corp colors | Fixed 8-color neon palette, assigned by registration order (`index % 8`) |
| Initial state | `GET /world` endpoint — same shape as `tick_complete`, queried live from DB |
| Reconnect | Auto-reconnect with exponential backoff (max 5s), "reconnecting…" indicator |
| Future map | Proper polygon city map (irregular districts, shared borders) deferred to a later plan |

---

## 1. Files Changed

| File | Change |
|---|---|
| `src/api/ws.js` | **Create** — WebSocket server module |
| `src/api/routes/world.js` | **Create** — `GET /world` endpoint |
| `public/index.html` | **Create** — single-page spectator dashboard |
| `src/api/server.js` | **Modify** — attach ws server, serve `public/`, add `/world` route, return `httpServer` |
| `src/index.js` | **Modify** — use `httpServer.listen()` instead of `app.listen()` |
| `src/game/tick.js` | **Modify** — add step 13: broadcast `tick_complete` after headlines |
| `tests/api/ws.test.js` | **Create** — WebSocket broadcast unit tests |
| `tests/api/world.test.js` | **Create** — GET /world endpoint tests |

---

## 2. `src/api/ws.js`

Single module that owns the WebSocket server.

```js
const WebSocket = require('ws');

let _wss = null;

function createWsServer(httpServer) {
  _wss = new WebSocket.Server({ server: httpServer, path: '/ws' });
  _wss.on('connection', (socket) => {
    socket.on('error', () => {}); // swallow individual client errors
  });
  return _wss;
}

function broadcast(message) {
  if (!_wss) return;
  const text = JSON.stringify(message);
  for (const client of _wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(text);
    }
  }
}

module.exports = { createWsServer, broadcast };
```

- `createWsServer(httpServer)` — called once at startup from `server.js`
- `broadcast(message)` — fire-and-forget; no-op if no clients connected or `_wss` not yet created
- Individual client errors are swallowed so a bad client cannot crash the server

---

## 3. `src/api/server.js` Changes

`createServer(db)` is updated to:

1. Create an explicit `http.Server`: `const httpServer = require('http').createServer(app)`
2. Call `createWsServer(httpServer)` to attach the WebSocket server
3. Add `app.use(express.static(path.join(__dirname, '../../public')))` to serve the dashboard
4. Register `GET /world` route (no auth required)
5. Return `{ app, httpServer }` instead of just `app`

`broadcast` is not returned from `createServer` — callers import it directly from `src/api/ws.js`.

---

## 4. `src/index.js` Changes

```js
const { app, httpServer } = createServer();
httpServer.listen(port, () => console.log(`Neon Syndicate running on port ${port}`));
```

---

## 5. `GET /world` Endpoint (`src/api/routes/world.js`)

No authentication required. Returns current world state — same shape as the `tick_complete` WebSocket payload — queried live from the DB. Used by the dashboard on initial load so there is something to display before the first tick fires.

```js
GET /world
Response: {
  "type": "world_state",
  "tick": 47,
  "districts": [{ "id", "name", "type", "ownerId", "ownerName", "fortificationLevel" }],
  "corporations": [{ "id", "name", "valuation", "reputation", "reputationLabel", "districtCount" }],
  "alliances": [{ "corpAId", "corpBId", "corpAName", "corpBName" }],
  "activeLaw": { "name", "effect" } | null,
  "headlines": ["HEADLINE ONE", ...]
}
```

`ownerName` is joined from the `corporations` table (null for unclaimed districts). `valuation` is computed via `calculateValuation`. `headlines` are the most recent `headline`-type events (up to 5, from the latest tick that has them).

---

## 6. Tick Loop Changes (`src/game/tick.js`)

`runTick` adds **Step 13** inside the `try` block, after headlines are written (step 8) and before `is_ticking` is cleared in `finally`:

```
13. Build and broadcast tick_complete WebSocket message
```

```js
const { broadcast } = require('../api/ws');

// Step 13: broadcast world state to dashboard clients
const districts = conn.prepare(`
  SELECT d.id, d.name, d.type, d.owner_id, c.name AS owner_name, d.fortification_level
  FROM districts d LEFT JOIN corporations c ON c.id = d.owner_id
  WHERE d.season_id = ?
`).all(seasonId);

const broadcastCorps = conn.prepare(
  'SELECT id, name, reputation FROM corporations WHERE season_id = ?'
).all(seasonId).map(c => ({
  id: c.id,
  name: c.name,
  valuation: calculateValuation(c, districts.filter(d => d.owner_id === c.id).length),
  reputation: c.reputation,
  reputationLabel: c.reputation >= 75 ? 'Trusted' : c.reputation >= 40 ? 'Neutral' : c.reputation >= 15 ? 'Notorious' : 'Pariah',
  districtCount: districts.filter(d => d.owner_id === c.id).length,
}));

const alliances = conn.prepare(`
  SELECT a.corp_a_id, a.corp_b_id, ca.name AS corp_a_name, cb.name AS corp_b_name
  FROM alliances a
  JOIN corporations ca ON ca.id = a.corp_a_id
  JOIN corporations cb ON cb.id = a.corp_b_id
  WHERE (ca.season_id = ? OR cb.season_id = ?) AND a.formed_tick IS NOT NULL AND a.broken_tick IS NULL
`).all(seasonId, seasonId);

const activeLaw = conn.prepare('SELECT name, effect FROM laws WHERE season_id = ? AND is_active = 1').get(seasonId);

const latestHeadlineEvent = conn.prepare(
  "SELECT narrative FROM events WHERE season_id = ? AND type = 'headline' ORDER BY tick DESC LIMIT 1"
).get(seasonId);
const headlines = latestHeadlineEvent ? latestHeadlineEvent.narrative.split('\n') : [];

broadcast({
  type: 'tick_complete',
  tick: newTick,
  districts: districts.map(d => ({
    id: d.id, name: d.name, type: d.type,
    ownerId: d.owner_id, ownerName: d.owner_name,
    fortificationLevel: d.fortification_level,
  })),
  corporations: broadcastCorps,
  alliances: alliances.map(a => ({
    corpAId: a.corp_a_id, corpBId: a.corp_b_id,
    corpAName: a.corp_a_name, corpBName: a.corp_b_name,
  })),
  activeLaw: activeLaw || null,
  headlines,
});
```

The `broadcast` call is fire-and-forget. If it throws (e.g., a client send error), the error is logged and the tick continues — `is_ticking` is always cleared in `finally`.

---

## 7. `public/index.html` — Dashboard

Single self-contained HTML file. Scripts loaded via CDN:
- `d3` v7 for the SVG map force layout and zoom behavior

### Layout

```
┌─────────────────────────────────────────┐
│ NEON SYNDICATE          TICK 047 · LIVE │  ← header bar
├─────────────────────────────────────────┤
│                         ┌─────────────┐ │
│  ⚖️ Data Sovereignty Act │ LEADERBOARD │ │  ← map with overlays
│                         │ 1. OmegaCorp│ │
│      SVG node graph     │ 2. NovaTech │ │
│    (pan + zoom via D3)  │ 3. ShadowNet│ │
│                         └─────────────┘ │
├─────────────────────────────────────────┤
│ ▶ OMEGACORP SEIZES MIDTOWN · NOVATECH  │  ← scrolling ticker
└─────────────────────────────────────────┘
```

### Components

**Header bar:** Corp name + tick number + season + live indicator (green dot pulses).

**City map (SVG):**
- Force-directed layout via `d3-force` — nodes are district circles, edges are adjacency links
- Layout stabilizes on first `GET /world` response; positions are then frozen (simulation stopped)
- District node: colored circle (corp color or neutral gray if unclaimed) + type emoji + district name below
- Adjacency edges: dark lines between adjacent nodes
- Pan/zoom: `d3.zoom()` applied to an SVG `<g>` wrapper containing all nodes and edges
- "SCROLL TO ZOOM · DRAG TO PAN" hint text rendered in the center background

**Corp color palette** (assigned by index of first appearance in registration order):
```
0: #7c3aed (purple)   1: #2563eb (blue)    2: #db2777 (pink)
3: #16a34a (green)    4: #ea580c (orange)  5: #0891b2 (cyan)
6: #ca8a04 (yellow)   7: #dc2626 (red)
```
Colors are assigned client-side based on the order corps appear in the `corporations` array from `GET /world`. The same order is maintained across WebSocket updates.

**Floating leaderboard (top-right overlay):**
- Semi-transparent dark background with blur backdrop
- Sorted by valuation descending
- Each row: rank number, color dot, corp name, valuation score
- Animates rank changes between ticks (slide up/down)

**Active law banner (top-left overlay):**
- Same semi-transparent style as leaderboard
- Shows law name; hidden if `activeLaw` is null

**Scrolling headline ticker (bottom bar):**
- Full width, 40px tall
- Headline text duplicated so the loop is always seamless regardless of total text length
- Animation speed: ~80px/s (adjusted so short messages don't loop too fast)
- New headlines from each `tick_complete` message replace old ones; animation restarts

### WebSocket client behavior

```js
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => { /* clear reconnecting indicator */ };
  ws.onmessage = (e) => render(JSON.parse(e.data));
  ws.onclose = () => {
    showReconnecting();
    setTimeout(connect, Math.min(retryMs *= 2, 5000));
  };
}
```

On page load:
1. `fetch('/world')` → render initial state
2. `connect()` → establish WebSocket, re-render on each `tick_complete`

`retryMs` starts at 500ms, doubles on each failed attempt, caps at 5000ms.

---

## 8. Testing

### `tests/api/ws.test.js`

- `broadcast()` before `createWsServer()` is called → no-op, no throw
- `broadcast()` with no connected clients → no-op
- `broadcast(message)` with one connected mock client → client receives `JSON.stringify(message)`
- `broadcast(message)` with multiple clients → all receive the message
- Client error during send → other clients still receive message (error swallowed)

Uses a real `http.Server` and `ws.WebSocket` client in-process (no mocking needed).

### `tests/api/world.test.js`

- `GET /world` returns 200 with correct shape (districts, corporations, alliances, activeLaw, headlines)
- `ownerName` is null for unclaimed districts
- `activeLaw` is null when no law is active
- `headlines` is empty array when no headline events exist

### `tests/game/tick.test.js` addition

- After `runTick`, verify `broadcast` was called with `type: 'tick_complete'` and correct `tick` value (mock `broadcast` via `jest.mock`)

---

## 9. Out of Scope

- Human player action submission UI (deferred to Plan 5 or later)
- Polygon/irregular district map (future enhancement)
- Mobile layout
- WebSocket authentication for human players (spec allows `?apiKey=` param — deferred)
- District tooltip / click-to-inspect detail panels
- Historical tick replay
