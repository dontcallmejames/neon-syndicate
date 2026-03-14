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
| `src/api/server.js` | **Modify** — attach ws server, serve `public/`, add `/world` route, return `{ app, httpServer }` |
| `src/index.js` | **Modify** — use `httpServer.listen()` instead of `app.listen()` |
| `src/game/tick.js` | **Modify** — add step 13: broadcast `tick_complete` after headlines |
| `tests/api/ws.test.js` | **Create** — WebSocket broadcast unit tests |
| `tests/api/world.test.js` | **Create** — GET /world endpoint tests |
| `tests/api/register.test.js` | **Modify** — destructure `{ app }` from `createServer()` |
| `tests/api/briefing.test.js` | **Modify** — destructure `{ app }` from `createServer()` |
| `tests/api/action.test.js` | **Modify** — destructure `{ app }` from `createServer()` |

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
      try {
        client.send(text);
      } catch (err) {
        console.warn('[ws] broadcast send error:', err.message);
      }
    }
  }
}

module.exports = { createWsServer, broadcast };
```

- `createWsServer(httpServer)` — called once at startup from `server.js`
- `broadcast(message)` — fire-and-forget; no-op if no clients connected or `_wss` not yet created
- Each `client.send()` is wrapped in try/catch so a failing client cannot interrupt delivery to other clients or propagate an error into the tick loop

---

## 3. `src/api/server.js` Changes

`createServer(db)` is updated to:

1. Create an explicit `http.Server`: `const httpServer = require('http').createServer(app)`
2. Call `createWsServer(httpServer)` to attach the WebSocket server
3. Register all API routes first, then add `app.use(express.static(path.join(__dirname, '../../public')))` after all routes, so no static filename can shadow an API path
4. Register `GET /world` route (no auth required)
5. Return `{ app, httpServer }` instead of just `app`

`broadcast` is not returned from `createServer` — callers import it directly from `src/api/ws.js`.

**Existing API test files** (`tests/api/register.test.js`, `tests/api/briefing.test.js`, `tests/api/action.test.js`) all call `createServer()` and use the result as an Express app. Each must be updated to destructure: `const { app } = createServer(db)`.

---

## 4. `src/index.js` Changes

```js
const { app, httpServer } = createServer();
httpServer.listen(port, () => console.log(`Neon Syndicate running on port ${port}`));
```

---

## 5. `GET /world` Endpoint (`src/api/routes/world.js`)

No authentication required. Follows the same factory pattern as other routes: `module.exports = function(conn) { return (req, res) => { ... }; }`.

Returns current world state — same shape as the `tick_complete` WebSocket payload — queried live from the DB. Used by the dashboard on initial load so there is something to display before the first tick fires.

**When no season is active** (status not `'active'`): return HTTP 200 with empty arrays and `tick: 0`:

```json
{ "type": "world_state", "tick": 0, "districts": [], "corporations": [], "alliances": [], "activeLaw": null, "headlines": [] }
```

**When a season is active:**

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

- `ownerName` is joined from the `corporations` table; null for unclaimed districts
- `valuation` is computed via `calculateValuation(corp, districtCount)` — requires all resource columns to be selected
- `corporations` are ordered `ORDER BY rowid ASC` (registration order) — this ordering is stable and must match the order used in `tick_complete` broadcasts so the client can maintain a consistent color assignment
- `headlines` are from the single most recent `headline`-type event row, split on `\n` — empty array if no such event exists

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

const broadcastCorps = conn.prepare(`
  SELECT id, name, reputation, credits, energy, workforce, intelligence, influence, political_power
  FROM corporations WHERE season_id = ? ORDER BY rowid ASC
`).all(seasonId).map(c => ({
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
  "SELECT narrative FROM events WHERE season_id = ? AND type = 'headline' AND tick = ?"
).get(seasonId, newTick);
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

The `broadcast` call is fire-and-forget. Each `client.send()` is wrapped in try/catch inside `ws.js` — errors are logged but do not propagate into `runTick`. `is_ticking` is always cleared in `finally` regardless.

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

**Header bar:** Game title + tick number + season + live indicator (green dot pulses).

**City map (SVG):**
- Force-directed layout via `d3-force` — nodes are district circles, edges are adjacency links
- Layout stabilizes on first `GET /world` response; positions are then frozen (simulation stopped)
- District node: colored circle (corp color or neutral gray if unclaimed) + type emoji + district name below
- Adjacency edges: dark lines between adjacent nodes
- Pan/zoom: `d3.zoom()` applied to an SVG `<g>` wrapper containing all nodes and edges
- "SCROLL TO ZOOM · DRAG TO PAN" hint text rendered in the center background

**Corp color palette** (assigned by index based on `ORDER BY rowid ASC` registration order):
```
0: #7c3aed (purple)   1: #2563eb (blue)    2: #db2777 (pink)
3: #16a34a (green)    4: #ea580c (orange)  5: #0891b2 (cyan)
6: #ca8a04 (yellow)   7: #dc2626 (red)
```
The client assigns colors on the first `GET /world` response by iterating the `corporations` array in order. The server always returns corps `ORDER BY rowid ASC`, so the mapping is stable across page reloads and WebSocket reconnects. If a corporation appears in a `tick_complete` message that was not present in the initial `GET /world` response, the client assigns it the next available palette index.

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
let retryMs = 500;

function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => {
    retryMs = 500; // reset backoff on successful connect
    hideReconnecting();
  };
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

`retryMs` resets to 500ms on each successful `onopen` so repeated disconnects always start at the short end of the backoff.

---

## 8. Testing

### `tests/api/ws.test.js`

- `broadcast()` before `createWsServer()` is called → no-op, no throw
- `broadcast()` with no connected clients → no-op
- `broadcast(message)` with one connected mock client → client receives `JSON.stringify(message)`
- `broadcast(message)` with multiple clients → all receive the message
- Client error during send → other clients still receive message (error swallowed, warn logged)

Uses a real `http.Server` and `ws.WebSocket` client in-process (no mocking needed).

### `tests/api/world.test.js`

- `GET /world` with no active season → 200 with `{ tick: 0, districts: [], corporations: [], alliances: [], activeLaw: null, headlines: [] }`
- `GET /world` with active season at `tick_count = 0` (no ticks run yet) → 200 with districts (all unclaimed), corporations (starting resources), no alliances, no law, no headlines
- `GET /world` returns correct shape after one tick (districts, corporations, alliances, activeLaw, headlines)
- `ownerName` is null for unclaimed districts
- `activeLaw` is null when no law is active
- `headlines` is empty array when no headline events exist

### `tests/game/tick.test.js` addition

- After `runTick`, verify `broadcast` was called with `type: 'tick_complete'` and correct `tick` value (mock `broadcast` via `jest.mock('../../src/api/ws')`)

---

## 9. Out of Scope

- Human player action submission UI (deferred to Plan 5 or later)
- Polygon/irregular district map (future enhancement)
- Mobile layout
- WebSocket authentication for human players (spec allows `?apiKey=` param — deferred)
- District tooltip / click-to-inspect detail panels
- Historical tick replay
