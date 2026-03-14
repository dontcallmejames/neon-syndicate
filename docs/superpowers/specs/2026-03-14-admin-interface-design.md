# Neon Syndicate — Plan 5: Admin Interface Design Spec
**Date:** 2026-03-14
**Status:** Approved

---

## Overview

Add a browser-based Game Master console to Neon Syndicate. The admin interface gives a human operator full control over the game: create and run seasons, manage corporations and districts, enact and repeal laws, inject events, and step through ticks manually. All admin API routes live under `/admin`, protected by a shared Bearer token. The UI is a single HTML file (`public/admin.html`) matching the spectator dashboard's neon aesthetic, with tabs and live WebSocket state updates.

---

## Core Design Decisions

| Dimension | Decision |
|---|---|
| Admin routes | All under `/admin`, protected by `adminAuth` middleware |
| Auth | `Authorization: Bearer <ADMIN_KEY>` — key from `process.env.ADMIN_KEY` env var, stored in `localStorage` on first prompt |
| UI | Single `public/admin.html` — vanilla JS + fetch, neon aesthetic matching spectator dashboard |
| Live updates | Subscribes to existing `/ws` WebSocket — reuses `tick_complete` messages, no new WS logic |
| Tabs | SEASON · CORPS · LAWS · EVENTS · LOG |
| Manual tick | `POST /admin/seasons/:id/tick` — reuses `runTick()`, returns 409 if already ticking |
| No `ADMIN_KEY` set | Admin routes return 503 (admin disabled) |
| Season status values | `pending` (existing default) → `active` ↔ `paused` → `ended` |
| Pause/resume | Implemented via `status = 'paused'`; tick loop skips non-`active` seasons, no global timer stop/start needed |

---

## 1. Files Changed

| File | Change |
|---|---|
| `public/admin.html` | **Create** — tabbed SPA, neon aesthetic, Bearer auth via localStorage prompt, live WS updates |
| `src/api/middleware/adminAuth.js` | **Create** — validates `Authorization: Bearer` against `ADMIN_KEY` env var; 503 if unset, 401 if wrong |
| `src/api/routes/admin/seasons.js` | **Create** — season CRUD + lifecycle controls + manual tick trigger |
| `src/api/routes/admin/corps.js` | **Create** — list corps with full resources, adjust resources, ban corp |
| `src/api/routes/admin/districts.js` | **Create** — reassign district owner (to corp or null) |
| `src/api/routes/admin/laws.js` | **Create** — enact law (deactivates previous), repeal active law |
| `src/api/routes/admin/events.js` | **Create** — inject headline/event, fetch paginated event log |
| `src/api/routes/admin/state.js` | **Create** — `GET /admin/state` handler |
| `src/api/server.js` | **Modify** — mount `/admin` routes behind `adminAuth` middleware |
| `src/db/schema.js` | **Modify** — add `starting_resources TEXT NOT NULL DEFAULT '{}'` column to `seasons` table |
| `src/api/routes/register.js` | **Modify** — apply `season.starting_resources` values when inserting corporation |
| `src/game/tick.js` | **Modify** — export `runTickNow(db, seasonId)` for use by manual tick endpoint |
| `tests/api/admin/seasons.test.js` | **Create** — season lifecycle and manual tick tests |
| `tests/api/admin/corps.test.js` | **Create** — corp management tests |
| `tests/api/admin/districts.test.js` | **Create** — district reassignment tests |
| `tests/api/admin/laws.test.js` | **Create** — law enact/repeal tests |
| `tests/api/admin/events.test.js` | **Create** — event injection and log tests |
| `tests/api/admin/auth.test.js` | **Create** — adminAuth middleware tests |

---

## 2. Season Status State Machine

The `seasons.status` column uses these values (existing schema: `TEXT NOT NULL DEFAULT 'pending'`):

| Status | Meaning |
|---|---|
| `pending` | Season created, not yet started. Corporations can register (existing `register.js` queries `WHERE status = 'pending'`). |
| `active` | Season running. Tick loop processes this season. |
| `paused` | Season paused. Tick loop skips this season (`WHERE status = 'active'`). No global timer stop/start needed. |
| `ended` | Season complete. No further ticks. |

**Valid transitions and error behavior:**

| Endpoint | Required current status | Resulting status | Error if precondition fails |
|---|---|---|---|
| `POST /admin/seasons/:id/start` | `pending` | `active` | 409 `{ error: 'Season is not in pending status' }` |
| `POST /admin/seasons/:id/pause` | `active` | `paused` | 409 `{ error: 'Season is not active' }` |
| `POST /admin/seasons/:id/resume` | `paused` | `active` | 409 `{ error: 'Season is not paused' }` |
| `POST /admin/seasons/:id/end` | `active` or `paused` | `ended` | 409 `{ error: 'Season is not active or paused' }` |
| `POST /admin/seasons/:id/tick` | `active` | — (tick_count++) | 409 `{ error: 'Season is not active' }` or 409 `{ error: 'Tick already in progress' }` |

---

## 3. `src/api/middleware/adminAuth.js`

```js
function adminAuth(req, res, next) {
  const key = process.env.ADMIN_KEY;
  if (!key) return res.status(503).json({ error: 'Admin interface disabled (ADMIN_KEY not set)' });
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${key}`) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

module.exports = adminAuth;
```

- Applied as a router-level middleware to all `/admin` routes
- No session state — every request carries the key

---

## 4. Admin API Routes

All routes require `Authorization: Bearer <ADMIN_KEY>`.

### `GET /admin/state`

Returns full current state to populate the admin UI on load. Scoped to the most recent season that is not `ended` (i.e., `pending`, `active`, or `paused`); if none exists, uses the most recent season of any status. If no seasons exist, `season` is null and all arrays are empty.

```json
{
  "season": { "id", "status", "tick_count", "season_length", "tick_interval_ms", "is_ticking", "scoring_weights": {...} } | null,
  "corps": [{ "id", "name", "credits", "energy", "workforce", "intelligence", "influence", "political_power", "reputation", "districtCount" }],
  "districts": [{ "id", "name", "type", "ownerId", "ownerName" }],
  "activeLaw": { "id", "name", "effect" } | null,
  "recentEvents": [{ "id", "type", "tick", "narrative" }]
}
```

Corps and districts are empty arrays when season is null. `recentEvents` contains up to 10 events for the selected season, ordered by `tick` descending. The `events` table has no `created_at` column — `tick` is the temporal reference used throughout the UI.

### Season Routes (`src/api/routes/admin/seasons.js`)

| Method | Path | Body | Action |
|---|---|---|---|
| `POST` | `/admin/seasons` | season config (see below) | Create new season with `status: 'pending'`; returns `{ id, status, season_length, tick_interval_ms, scoring_weights, starting_resources }` |
| `POST` | `/admin/seasons/:id/start` | — | `pending` → `active` |
| `POST` | `/admin/seasons/:id/pause` | — | `active` → `paused` |
| `POST` | `/admin/seasons/:id/resume` | — | `paused` → `active` |
| `POST` | `/admin/seasons/:id/end` | — | `active` or `paused` → `ended` |
| `POST` | `/admin/seasons/:id/tick` | — | Run one tick immediately; see Section 5 for guard details |

See Section 2 for error responses on invalid transitions.

**`POST /admin/seasons` body** (all fields optional, defaults shown):

```json
{
  "season_length": 100,
  "tick_interval_ms": 60000,
  "scoring": {
    "credits": 1,
    "energy": 1,
    "workforce": 1,
    "intelligence": 1,
    "influence": 1,
    "political_power": 1,
    "districts": 10
  },
  "starting_resources": {
    "credits": 1000,
    "energy": 500,
    "workforce": 500,
    "intelligence": 200,
    "influence": 200,
    "political_power": 100
  }
}
```

`scoring_weights` and `starting_resources` are stored as JSON TEXT in the seasons table and returned as **parsed objects** (not raw strings) in all API responses.

`starting_resources` requires a new column (`starting_resources TEXT NOT NULL DEFAULT '{}'`) added to `seasons` in `schema.js`. When `POST /register` is called, `register.js` reads `season.starting_resources` (parsed), merges with corporation schema defaults (credits=10, energy=8, workforce=6, intelligence=4, influence=0, political_power=0), and passes all resource values explicitly to the `INSERT INTO corporations` statement. Values from `starting_resources` override schema defaults where provided.

### Corp Routes (`src/api/routes/admin/corps.js`)

| Method | Path | Body | Action |
|---|---|---|---|
| `GET` | `/admin/corps` | — | List corps in active/paused season, ordered by `rowid ASC` (registration order); empty array if no such season exists |
| `PATCH` | `/admin/corps/:id` | `{ credits?, energy?, workforce?, intelligence?, influence?, political_power?, reputation? }` | Apply additive delta to corp resources; each resource is clamped to a minimum of 0 after the delta; returns 404 if corp not found |
| `DELETE` | `/admin/corps/:id` | — | Ban corp — see cascade behavior below; returns 404 if corp not found |

**`DELETE /admin/corps/:id` cascade** — the DB has no FK cascade on `districts.owner_id` (it is a plain nullable TEXT column). The endpoint must execute all of the following in a transaction:

1. `UPDATE districts SET owner_id = NULL WHERE owner_id = :corpId`
2. `DELETE FROM pending_actions WHERE corp_id = :corpId`
3. `DELETE FROM alliances WHERE corp_a_id = :corpId OR corp_b_id = :corpId`
4. `DELETE FROM embargoes WHERE corp_id = :corpId OR target_corp_id = :corpId`
5. `DELETE FROM briefings WHERE corp_id = :corpId`
6. `DELETE FROM corporations WHERE id = :corpId`

Returns 404 if corp not found.

### District Routes (`src/api/routes/admin/districts.js`)

| Method | Path | Body | Action |
|---|---|---|---|
| `PATCH` | `/admin/districts/:id` | `{ ownerId: string \| null }` | Reassign district owner; null unclaims it; returns 404 if district not found |

If `ownerId` is provided, it must be a valid corporation id in the same season — returns 400 `{ error: 'Invalid ownerId' }` otherwise.

### Law Routes (`src/api/routes/admin/laws.js`)

All law operations are scoped to the current active or paused season. Returns 404 `{ error: 'No active season' }` if no such season exists.

| Method | Path | Body | Action |
|---|---|---|---|
| `POST` | `/admin/laws` | `{ name, effect }` | Enact law in active/paused season — sets any currently active law to `is_active = 0` first, then inserts new law with `is_active = 1`; returns 400 if `name` or `effect` is missing; note: `laws` has `UNIQUE(season_id, name)` — returns 409 if a law with that name already exists in the season |
| `DELETE` | `/admin/laws/:id` | — | Repeal law: `UPDATE laws SET is_active = 0 WHERE id = :id`; returns 404 if law not found |

### Event Routes (`src/api/routes/admin/events.js`)

All event operations are scoped to the current active or paused season. Returns 404 `{ error: 'No active season' }` if no such season exists.

| Method | Path | Body | Action |
|---|---|---|---|
| `POST` | `/admin/events` | `{ type, narrative }` | Inject event into active/paused season at current `tick_count`; `type` must be one of `headline`, `action`, or `system` — returns 400 if type is invalid or either field is missing |
| `GET` | `/admin/events` | `?limit=50&offset=0` | Paginated event log for active/paused season, ordered by `tick` descending |

---

## 5. `src/game/tick.js` Changes

Add `runTickNow(db, seasonId)` — calls `runTick(db, seasonId)` directly, bypassing the scheduler timer.

```js
async function runTickNow(db, seasonId) {
  return runTick(db, seasonId);
}

module.exports = { runTick, startTickLoop, stopTickLoop, runTickNow };
```

**409 guard lives entirely in the endpoint** — `runTick` does not check `is_ticking` before entering; it sets `is_ticking = 1` in the DB early in execution and clears it in `finally`. The manual tick endpoint reads `season.is_ticking` and returns 409 before calling `runTickNow` if it is truthy. There is a small race window between the SELECT and `runTick` entry, which is acceptable for a single-operator admin tool.

```js
router.post('/:id/tick', async (req, res) => {
  const season = conn.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  if (season.status !== 'active') return res.status(409).json({ error: 'Season is not active' });
  if (season.is_ticking) return res.status(409).json({ error: 'Tick already in progress' });
  await runTickNow(conn, season.id);
  res.json({ ok: true });
});
```

---

## 6. `public/admin.html` — Admin SPA

Single self-contained HTML file. No build step. No CDN dependencies required beyond vanilla JS.

### Auth Flow

On load:
1. Check `localStorage.getItem('adminKey')`
2. If missing, show a centered prompt: "Enter admin key:" with a text input and submit button
3. Validate by calling `GET /admin/state` with `Authorization: Bearer <key>`
4. **On 401**: clear stored key, show "Invalid key — try again" and re-prompt
5. **On 503**: show "Admin interface is disabled on this server (ADMIN_KEY not configured)" — do not re-prompt or store key
6. **On success**: store key in `localStorage`, render full UI

### Layout

```
┌──────────────────────────────────────────────────────┐
│ NEON SYNDICATE — ADMIN     TICK 047 · SEASON 1 · LIVE │  ← header
├──────────────────────────────────────────────────────┤
│ [SEASON] [CORPS] [LAWS] [EVENTS] [LOG]                │  ← tab bar
├──────────────────────────────────────────────────────┤
│                                                        │
│  Tab content area                                      │
│                                                        │
└──────────────────────────────────────────────────────┘
```

### Tab: SEASON

- Current season status badge (`PENDING` / `ACTIVE` / `PAUSED` / `ENDED` / `NO SEASON`)
- Tick count and tick interval display
- Lifecycle buttons — visibility rules:
  - `pending`: show **START**
  - `active`: show **PAUSE**, **END**, **RUN TICK NOW**
  - `paused`: show **RESUME**, **END**
  - `ended` or no season: show no lifecycle buttons
- **RUN TICK NOW** is disabled while `is_ticking` is true
- "Create New Season" section (always visible):
  - Collapsed by default; expands on "New Season" button click
  - All fields from `POST /admin/seasons` body, pre-filled with defaults
  - Submit creates season in `pending` status

### Tab: CORPS

- Table: rank, color dot, name, credits, energy, workforce, intelligence, influence, political_power, reputation, district count
- "No active season" message if no active/paused season
- Each row: **Adjust** button (opens inline form for resource deltas, values can be negative to subtract; displayed label clarifies delta semantics) and **Ban** button (browser `confirm()` dialog before firing `DELETE`)

### Tab: LAWS

- Current active law display (or "No active law")
- **Repeal** button if a law is active
- "Enact Law" form: name field + effect textarea + submit

### Tab: EVENTS

- "Inject Event" form: type dropdown (`headline` | `action` | `system`) + narrative textarea + submit
- Inline preview table showing the **10 most recent events** (non-paginated): tick, type, narrative (truncated to 80 chars, full text in `title` attribute)
- "No active season" message if no active/paused season

### Tab: LOG

- Full paginated event log for the current active/paused season, newest first
- Uses `GET /admin/events?limit=50&offset=0`; "Load More" button increments `offset` by 50 and appends results
- Shows: tick, type, full narrative (not truncated)
- "No active season" message if applicable

### WebSocket Behavior

Connects to `/ws` with the same exponential-backoff reconnect logic as the spectator dashboard (copy the `connect()` function from `public/index.html`). On `tick_complete`:
- Updates tick counter in header
- If CORPS tab is active: re-fetches `GET /admin/corps` and re-renders table
- If SEASON tab is active: updates tick count and `is_ticking` display

The admin key is **not** sent over WebSocket — the spectator socket is unauthenticated and read-only.

---

## 7. `src/api/server.js` Changes

```js
const adminAuth = require('./middleware/adminAuth');
const adminState = require('./routes/admin/state');
const adminSeasons = require('./routes/admin/seasons');
const adminCorps = require('./routes/admin/corps');
const adminDistricts = require('./routes/admin/districts');
const adminLaws = require('./routes/admin/laws');
const adminEvents = require('./routes/admin/events');

// Mount admin routes (before static middleware, so no static file can shadow /admin)
app.use('/admin', adminAuth);
app.get('/admin/state', adminState(db));
app.use('/admin/seasons', adminSeasons(db));
app.use('/admin/corps', adminCorps(db));
app.use('/admin/districts', adminDistricts(db));
app.use('/admin/laws', adminLaws(db));
app.use('/admin/events', adminEvents(db));
```

All admin route modules follow the same factory pattern as existing routes: `module.exports = function(db) { return router; }`. The exception is `state.js`, which exports a bare handler factory: `module.exports = function(db) { return (req, res) => { ... }; }` — this is because `GET /admin/state` is mounted as a single `app.get` call rather than a sub-router.

---

## 8. Testing

### `tests/api/admin/auth.test.js`

- No `Authorization` header → 401
- Wrong key → 401
- Correct key → passes through (200 on `GET /admin/state`)
- `ADMIN_KEY` not set in env → 503 on all `/admin` routes

### `tests/api/admin/seasons.test.js`

- `POST /admin/seasons` with all defaults → creates season with `status: 'pending'`, correct default values in DB; response body includes `id`
- `POST /admin/seasons` with custom params → all fields stored correctly (season_length, tick_interval_ms, scoring weights, starting_resources)
- `POST /admin/seasons` with custom `starting_resources` → subsequent `POST /register` creates corp with those resource values (not schema defaults)
- `POST /admin/seasons` without `starting_resources` → subsequent `POST /register` creates corp with schema defaults (credits=10, energy=8, workforce=6, intelligence=4, influence=0, political_power=0)
- Start (`pending` → `active`) → `SELECT status FROM seasons` returns `'active'`
- Start from non-`pending` status → 409
- Pause (`active` → `paused`) → `SELECT status FROM seasons` returns `'paused'`
- Pause from non-`active` status → 409
- Resume (`paused` → `active`) → `SELECT status FROM seasons` returns `'active'`
- Resume from non-`paused` status → 409
- End from `active` → `SELECT status FROM seasons` returns `'ended'`
- End from `paused` → `SELECT status FROM seasons` returns `'ended'`
- End from `pending` → 409
- Manual tick on `active` season → `tick_count` increments by 1 (verify via `GET /admin/state`)
- Manual tick on non-`active` season → 409 `'Season is not active'`
- Manual tick while `is_ticking = 1` (set manually in DB before request) → 409 `'Tick already in progress'`

### `tests/api/admin/corps.test.js`

- `GET /admin/corps` with active season → response includes all resource columns (credits, energy, workforce, intelligence, influence, political_power, reputation, districtCount), ordered by rowid ASC
- `GET /admin/corps` with no active/paused season → 200 with empty array
- `PATCH /admin/corps/:id` positive delta → resource increased by delta amount
- `PATCH /admin/corps/:id` negative delta that would go below zero → resource clamped to 0
- `PATCH /admin/corps/:id` with unknown id → 404
- `DELETE /admin/corps/:id` → corp row deleted; formerly-owned districts have `owner_id = NULL`; no orphaned pending_actions, alliances, embargoes, or briefings for that corp
- `DELETE /admin/corps/:id` with unknown id → 404

### `tests/api/admin/districts.test.js`

- `PATCH /admin/districts/:id` with valid corp id → `owner_id` updated in DB
- `PATCH /admin/districts/:id` with `ownerId: null` → `owner_id` set to NULL
- `PATCH /admin/districts/:id` with invalid corp id → 400
- `PATCH /admin/districts/:id` with unknown district id → 404

### `tests/api/admin/laws.test.js`

- `POST /admin/laws` with no prior law → law created with `is_active = 1`
- `POST /admin/laws` with existing active law → previous law set to `is_active = 0`, new law has `is_active = 1`
- `POST /admin/laws` with missing `name` or `effect` → 400
- `POST /admin/laws` with duplicate name in same season → 409
- `POST /admin/laws` with no active/paused season → 404
- `DELETE /admin/laws/:id` → `is_active = 0` for that law
- `DELETE /admin/laws/:id` with non-existent law id → 404
- `DELETE /admin/laws/:id` with no active/paused season → 404

### `tests/api/admin/events.test.js`

- `POST /admin/events` → event row in DB with correct `season_id`, `tick` = current `tick_count`, `type`, `narrative`
- `POST /admin/events` with invalid `type` (not headline/action/system) → 400
- `POST /admin/events` with missing `type` or `narrative` → 400
- `POST /admin/events` with no active/paused season → 404
- `GET /admin/events` → returns events in descending tick order
- `GET /admin/events?limit=2&offset=0` → returns first 2 events
- `GET /admin/events?limit=2&offset=2` → returns next 2 events (pagination)
- `GET /admin/events` with no active/paused season → 404

---

## 9. Out of Scope

- Multi-user admin accounts or roles
- Audit log of admin actions
- Season history / replay viewer
- Mobile layout
- Bulk operations (e.g. reset all corps at once)
- WebSocket authentication for admin (admin page uses REST with Bearer token)
