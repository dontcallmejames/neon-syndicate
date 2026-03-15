# Human Player UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-based human player interface to Neon Syndicate — a landing/auth page at `/play` and a full game view at `/game` — so humans can register and play alongside AI agents.

**Architecture:** Two vanilla JS static HTML files served by the existing Express server (same pattern as `public/admin.html`). The game view connects via WebSocket for live tick updates and polls `GET /briefing/:agentId` each tick. Server gets three small additions: a `last_tick_at` column on seasons, `nextTickAt` in briefing responses, and `nextTickAt` in tick_complete broadcasts.

**Tech Stack:** Vanilla JS (no framework, no build step), Express static serving, SVG for the city map, WebSocket (existing `/ws` endpoint), better-sqlite3.

**Spec:** `docs/superpowers/specs/2026-03-14-human-player-ui-design.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/db/schema.js` | Modify | Add `last_tick_at INTEGER DEFAULT 0` to seasons via ALTER TABLE |
| `src/game/tick.js` | Modify | Set `last_tick_at = Date.now()` each tick; add `nextTickAt` to broadcast |
| `src/api/routes/briefing.js` | Modify | Add `nextTickAt` to briefing payload |
| `src/api/server.js` | Modify | Add `GET /play` and `GET /game` routes |
| `public/play.html` | Create | Landing / auth page |
| `public/game.html` | Create | Full game view |
| `tests/db/schema.test.js` | Modify | Add test: seasons table has `last_tick_at` column |
| `tests/game/tick.test.js` | Modify | Add test: `runTick` sets `last_tick_at` on season |
| `tests/api/briefing.test.js` | Modify | Add test: briefing response includes `nextTickAt` |
| `tests/api/server.test.js` | Create | Tests for `/play` and `/game` routes returning 200 |

---

## Chunk 1: Server-side changes — tick timer + new routes

### Task 1: `last_tick_at` schema column

**Files:**
- Modify: `src/db/schema.js:135-138`
- Modify: `tests/db/schema.test.js`

**Background:** `src/db/schema.js` initializes the DB. It already has an ALTER TABLE pattern at line 135 for adding new columns to existing DBs. The `seasons` table needs `last_tick_at INTEGER DEFAULT 0` so clients can compute when the next tick fires.

- [ ] **Step 1: Write the failing test**

Open `tests/db/schema.test.js` and add this test at the bottom:

```js
test('seasons table has last_tick_at column', () => {
  const db = new Database(':memory:');
  initDb(db);
  const cols = db.prepare("PRAGMA table_info(seasons)").all().map(c => c.name);
  expect(cols).toContain('last_tick_at');
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/db/schema.test.js --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `last_tick_at` not in columns list.

- [ ] **Step 3: Add `last_tick_at` to the schema**

In `src/db/schema.js`, add a second ALTER TABLE catch block immediately after the existing one (around line 138):

```js
  try {
    conn.exec("ALTER TABLE seasons ADD COLUMN last_tick_at INTEGER NOT NULL DEFAULT 0");
  } catch (_) { /* column already exists — safe to ignore */ }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/db/schema.test.js --no-coverage 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.js tests/db/schema.test.js
git commit -m "feat: add last_tick_at column to seasons"
```

---

### Task 2: Set `last_tick_at` in `runTick` + add `nextTickAt` to broadcast

**Files:**
- Modify: `src/game/tick.js:98` (near the tick increment)
- Modify: `src/game/tick.js:224` (the broadcast call)
- Modify: `tests/game/tick.test.js`

**Background:** `runTick` in `src/game/tick.js` increments `tick_count` and sets `is_ticking`. It also broadcasts a `tick_complete` message at line ~224. We need to:
1. Record `last_tick_at = Date.now()` when the tick fires.
2. Include `nextTickAt = Date.now() + tick_interval_ms` in the broadcast so clients can start a countdown timer.

The season's `tick_interval_ms` is available on the `season` object fetched at line 84.

- [ ] **Step 1: Write the failing test**

In `tests/game/tick.test.js`, add this test at the bottom (before the final `}`):

```js
test('runTick sets last_tick_at on the season', async () => {
  const before = Date.now();
  await runTick(db, seasonId);
  const after = Date.now();
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  expect(season.last_tick_at).toBeGreaterThanOrEqual(before);
  expect(season.last_tick_at).toBeLessThanOrEqual(after);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/game/tick.test.js --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `last_tick_at` is 0.

- [ ] **Step 3: Set `last_tick_at` in `runTick`**

In `src/game/tick.js`, find this line (around line 98):

```js
conn.prepare('UPDATE seasons SET tick_count = ?, is_ticking = 1 WHERE id = ?').run(newTick, seasonId);
```

Replace it with:

```js
conn.prepare('UPDATE seasons SET tick_count = ?, is_ticking = 1, last_tick_at = ? WHERE id = ?').run(newTick, Date.now(), seasonId);
```

- [ ] **Step 4: Add `nextTickAt` to the `tick_complete` broadcast**

In `src/game/tick.js`, find the `broadcast({` call (around line 224). Add `nextTickAt` to the payload:

```js
broadcast({
  type: 'tick_complete',
  tick: newTick,
  nextTickAt: Date.now() + season.tick_interval_ms,
  districts: broadcastDistricts.map(/* ... existing ... */),
  // ... rest unchanged
});
```

- [ ] **Step 5: Run tests**

```bash
npx jest tests/game/tick.test.js --no-coverage 2>&1 | tail -10
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/game/tick.js tests/game/tick.test.js
git commit -m "feat: set last_tick_at on tick and include nextTickAt in broadcast"
```

---

### Task 3: Add `nextTickAt` to briefing response

**Files:**
- Modify: `src/api/routes/briefing.js:13-15` (season fetch + payload)
- Modify: `tests/api/briefing.test.js`

**Background:** The briefing route at `src/api/routes/briefing.js` fetches `season` at line 13 and builds a payload. We need to include `nextTickAt: season.last_tick_at + season.tick_interval_ms` in the payload so clients that load fresh (without a WebSocket event) can seed their timer. `nextTickAt` should be 0 when `last_tick_at` is 0 (game hasn't started), which clients should treat as "timer not yet available".

- [ ] **Step 1: Write the failing test**

In `tests/api/briefing.test.js`, add this test at the bottom:

```js
test('GET /briefing/:agentId includes nextTickAt in response', async () => {
  const res = await request(app)
    .get(`/briefing/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`);

  expect(res.status).toBe(200);
  expect(typeof res.body.nextTickAt).toBe('number');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/api/briefing.test.js --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `nextTickAt` is undefined.

- [ ] **Step 3: Add `nextTickAt` to the live briefing payload**

In `src/api/routes/briefing.js`, in the `payload` object (around line 71), add `nextTickAt`:

```js
const payload = {
  tick: currentTick,
  generating: isGenerating,
  nextTickAt: season ? (season.last_tick_at || 0) + (season.tick_interval_ms || 0) : 0,
  // ... rest unchanged
};
```

Also update the stored-briefing path (line ~22) — stored briefings won't have `nextTickAt`, so inject it there too. Find:

```js
if (stored && stored.tick === currentTick && !isGenerating) {
  return res.json(JSON.parse(stored.payload));
}
```

Replace with:

```js
if (stored && stored.tick === currentTick && !isGenerating) {
  const payload = JSON.parse(stored.payload);
  payload.nextTickAt = (season.last_tick_at || 0) + (season.tick_interval_ms || 0);
  return res.json(payload);
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/api/briefing.test.js --no-coverage 2>&1 | tail -10
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/briefing.js tests/api/briefing.test.js
git commit -m "feat: add nextTickAt to briefing response"
```

---

### Task 4: Add `/play` and `/game` routes to server

**Files:**
- Modify: `src/api/server.js:26-29`
- Create: `tests/api/server.test.js`

**Background:** The server currently serves `/admin` via `app.get('/admin', ...)`. We need the same pattern for `/play` and `/game`. These routes serve the static HTML files and require no auth (auth is handled client-side).

The files `public/play.html` and `public/game.html` will be created in later tasks. For now the tests will check that the routes are registered; we'll use a placeholder approach.

- [ ] **Step 1: Create the test file**

```bash
touch tests/api/server.test.js
```

Write `tests/api/server.test.js`:

```js
// tests/api/server.test.js
const request = require('supertest');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { initDb } = require('../../src/db/schema');
const { createServer } = require('../../src/api/server');

let app, db;

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  ({ app } = createServer(db));

  // Create placeholder HTML files if they don't exist
  const publicDir = path.join(__dirname, '../../public');
  if (!fs.existsSync(path.join(publicDir, 'play.html'))) {
    fs.writeFileSync(path.join(publicDir, 'play.html'), '<html><body>play</body></html>');
  }
  if (!fs.existsSync(path.join(publicDir, 'game.html'))) {
    fs.writeFileSync(path.join(publicDir, 'game.html'), '<html><body>game</body></html>');
  }
});
afterEach(() => db.close());

test('GET /play returns 200', async () => {
  const res = await request(app).get('/play');
  expect(res.status).toBe(200);
});

test('GET /game returns 200', async () => {
  const res = await request(app).get('/game');
  expect(res.status).toBe(200);
});

test('GET /health still works', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/api/server.test.js --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `/play` and `/game` return 404.

- [ ] **Step 3: Add the routes to `src/api/server.js`**

In `src/api/server.js`, add these two lines after the `/admin` HTML route (around line 33):

```js
app.get('/play', (_req, res) => res.sendFile(path.join(__dirname, '../../public/play.html')));
app.get('/game', (_req, res) => res.sendFile(path.join(__dirname, '../../public/game.html')));
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/api/server.test.js --no-coverage 2>&1 | tail -10
```

Expected: all PASS.

- [ ] **Step 5: Run full test suite to confirm nothing is broken**

```bash
npx jest --no-coverage 2>&1 | tail -20
```

Expected: all existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/server.js tests/api/server.test.js
git commit -m "feat: add /play and /game routes to server"
```

---

## Chunk 2: Landing page + game shell

### Task 5: `public/play.html` — Landing / auth page

**Files:**
- Create: `public/play.html`

**Background:** This is the entry point for human players. On first visit, they register a new corporation. On return visits, they enter their saved credentials. On success, credentials are saved to `localStorage` and the player is redirected to `/game`.

The page style should match the dark cyberpunk theme of `public/admin.html` — dark backgrounds, monospace font, neon accents. Reference `public/admin.html` for the CSS approach.

All API calls here are unauthenticated or use the newly obtained API key. There are no automated tests for this file — verify manually by running the game server and visiting `/play`.

- [ ] **Step 1: Create `public/play.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Neon Syndicate — Enter the Game</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #030712; color: #e5e7eb;
      font-family: monospace; font-size: 13px;
      min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center; padding: 24px;
    }
    h1 { color: #00f5c4; font-size: 18px; letter-spacing: 4px; margin-bottom: 6px; }
    .tagline { color: #374151; font-size: 11px; letter-spacing: 2px; margin-bottom: 40px; }

    .cards { display: flex; gap: 24px; max-width: 700px; width: 100%; flex-wrap: wrap; }
    .card {
      flex: 1; min-width: 280px;
      background: #0a0a1a; border: 1px solid #1f2937;
      border-radius: 8px; padding: 20px;
    }
    .card h2 { color: #6366f1; font-size: 11px; letter-spacing: 2px; margin-bottom: 16px; }

    label { color: #6b7280; font-size: 10px; display: block; margin-bottom: 4px; }
    input, textarea {
      background: #030712; border: 1px solid #374151; color: #e5e7eb;
      padding: 8px; width: 100%; font-family: monospace; font-size: 12px;
      border-radius: 4px; margin-bottom: 12px;
    }
    textarea { resize: vertical; height: 60px; }
    input:focus, textarea:focus { outline: none; border-color: #6366f1; }

    .btn {
      background: #1f1f3a; border: 1px solid #6366f1; color: #a78bfa;
      padding: 8px 16px; cursor: pointer; font-family: monospace; font-size: 12px;
      border-radius: 4px; width: 100%; letter-spacing: 1px;
    }
    .btn:hover { background: #2d1f6e; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-success { border-color: #00f5c4; color: #00f5c4; }
    .btn-success:hover { background: #0a2a22; }

    .error { color: #ef4444; font-size: 11px; margin-bottom: 8px; display: none; }
    .success-box {
      background: #0a2a22; border: 1px solid #00f5c4; border-radius: 6px;
      padding: 12px; margin-top: 12px; display: none;
    }
    .success-box p { color: #6b7280; font-size: 10px; margin-bottom: 4px; }
    .cred-row { display: flex; gap: 6px; margin-bottom: 6px; }
    .cred-val {
      flex: 1; background: #030712; border: 1px solid #1f2937;
      color: #00f5c4; padding: 5px 8px; font-family: monospace; font-size: 10px;
      border-radius: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .copy-btn {
      background: #0a0a1a; border: 1px solid #374151; color: #9ca3af;
      padding: 5px 10px; cursor: pointer; font-family: monospace; font-size: 10px;
      border-radius: 4px; flex-shrink: 0;
    }
    .copy-btn:hover { border-color: #00f5c4; color: #00f5c4; }
    .redirect-msg { color: #6b7280; font-size: 10px; margin-top: 8px; text-align: center; }

    .divider { color: #1f2937; font-size: 10px; text-align: center; margin: 12px 0; }

    .season-notice {
      max-width: 700px; width: 100%; margin-bottom: 20px;
      background: #1a0f00; border: 1px solid #fbbf24; border-radius: 6px;
      padding: 10px 14px; color: #fbbf24; font-size: 11px; display: none;
    }
  </style>
</head>
<body>

<h1>NEON SYNDICATE</h1>
<p class="tagline">CORPORATE WARFARE IN THE MEGACITY</p>

<div class="season-notice" id="season-notice"></div>

<div class="cards">

  <!-- New Corp card -->
  <div class="card">
    <h2>NEW CORPORATION</h2>
    <div class="error" id="reg-error"></div>

    <label>CORP NAME</label>
    <input id="reg-name" type="text" placeholder="e.g. Tyrell Dynamics" maxlength="40">

    <label>DESCRIPTION (one sentence)</label>
    <textarea id="reg-desc" placeholder="What your corp is known for..."></textarea>

    <button class="btn" id="reg-btn" onclick="register()">REGISTER CORPORATION</button>

    <div class="success-box" id="reg-success">
      <p>REGISTRATION SUCCESSFUL — SAVE THESE CREDENTIALS</p>
      <label>AGENT ID</label>
      <div class="cred-row">
        <div class="cred-val" id="reg-agent-id"></div>
        <button class="copy-btn" id="copy-agent-id">COPY</button>
      </div>
      <label>API KEY</label>
      <div class="cred-row">
        <div class="cred-val" id="reg-api-key"></div>
        <button class="copy-btn" id="copy-api-key">COPY</button>
      </div>
      <p class="redirect-msg" id="redirect-msg">Entering the game in 3 seconds...</p>
    </div>
  </div>

  <!-- Returning player card -->
  <div class="card">
    <h2>RETURNING PLAYER</h2>
    <div class="error" id="login-error"></div>

    <label>AGENT ID</label>
    <input id="login-agent-id" type="text" placeholder="uuid">

    <label>API KEY</label>
    <input id="login-api-key" type="text" placeholder="uuid">

    <button class="btn btn-success" id="login-btn" onclick="login()">ENTER THE GAME</button>
  </div>

</div>

<script>
  // Check for saved credentials on load — redirect immediately if valid
  (async function checkSaved() {
    const agentId = localStorage.getItem('ns_agent_id');
    const apiKey  = localStorage.getItem('ns_api_key');
    if (!agentId || !apiKey) return;
    try {
      const res = await fetch(`/briefing/${agentId}`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      if (res.ok) { window.location.href = '/game'; }
    } catch (_) { /* ignore — server may be starting */ }
  })();

  // Check season status on load
  (async function checkSeason() {
    try {
      const res = await fetch('/world');
      if (!res.ok) return;
      const data = await res.json();
      if (data.tick === 0 && data.corporations.length === 0) {
        document.getElementById('season-notice').style.display = 'block';
        document.getElementById('season-notice').textContent =
          'No active season — registration may not be available yet. Ask the admin to create a season.';
      }
    } catch (_) {}
  })();

  async function register() {
    const name = document.getElementById('reg-name').value.trim();
    const description = document.getElementById('reg-desc').value.trim();
    const errEl = document.getElementById('reg-error');
    errEl.style.display = 'none';

    if (!name) { errEl.textContent = 'Corp name is required'; errEl.style.display = 'block'; return; }

    const btn = document.getElementById('reg-btn');
    btn.disabled = true;
    btn.textContent = 'REGISTERING...';

    try {
      const res = await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error || 'Registration failed';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'REGISTER CORPORATION';
        return;
      }

      // Show credentials
      document.getElementById('reg-agent-id').textContent = data.agentId;
      document.getElementById('reg-api-key').textContent  = data.apiKey;
      document.getElementById('reg-success').style.display = 'block';
      btn.style.display = 'none';

      // Wire copy buttons
      document.getElementById('copy-agent-id').addEventListener('click', () => {
        navigator.clipboard.writeText(data.agentId);
        document.getElementById('copy-agent-id').textContent = 'COPIED';
      });
      document.getElementById('copy-api-key').addEventListener('click', () => {
        navigator.clipboard.writeText(data.apiKey);
        document.getElementById('copy-api-key').textContent = 'COPIED';
      });

      // Save + redirect countdown
      localStorage.setItem('ns_agent_id', data.agentId);
      localStorage.setItem('ns_api_key',  data.apiKey);
      let secs = 3;
      const countdown = setInterval(() => {
        secs--;
        if (secs <= 0) { clearInterval(countdown); window.location.href = '/game'; }
        else { document.getElementById('redirect-msg').textContent = `Entering the game in ${secs} seconds...`; }
      }, 1000);

    } catch (err) {
      errEl.textContent = 'Cannot reach server — try refreshing';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'REGISTER CORPORATION';
    }
  }

  async function login() {
    const agentId = document.getElementById('login-agent-id').value.trim();
    const apiKey  = document.getElementById('login-api-key').value.trim();
    const errEl   = document.getElementById('login-error');
    errEl.style.display = 'none';

    if (!agentId || !apiKey) {
      errEl.textContent = 'Both Agent ID and API Key are required';
      errEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.textContent = 'VERIFYING...';

    try {
      const res = await fetch(`/briefing/${agentId}`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      if (!res.ok) {
        errEl.textContent = 'Invalid credentials';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'ENTER THE GAME';
        return;
      }
      localStorage.setItem('ns_agent_id', agentId);
      localStorage.setItem('ns_api_key',  apiKey);
      window.location.href = '/game';
    } catch (err) {
      errEl.textContent = 'Cannot reach server — try refreshing';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'ENTER THE GAME';
    }
  }
</script>
</body>
</html>
```

- [ ] **Step 2: Verify manually**

Start the server (`node src/index.js`) and open `http://localhost:3000/play` in a browser. Confirm:
- Page loads with two cards (New Corp + Returning Player)
- Registering a corp shows the credentials and redirects after 3 seconds
- Returning player form validates credentials and redirects

- [ ] **Step 3: Commit**

```bash
git add public/play.html
git commit -m "feat: add /play landing and auth page"
```

---

### Task 6: `public/game.html` — Game shell, top bar, tick timer, WebSocket

**Files:**
- Create: `public/game.html`

**Background:** This is the main game view. On load it reads credentials from `localStorage`, fetches the briefing, and opens a WebSocket connection. The top bar shows corp name, all six resources, reputation, valuation, and a countdown tick timer. The map, side panel, and log panel are stubs in this task — they get filled in Tasks 7–9.

The WebSocket connection follows the same pattern as `public/admin.html`. On `tick_complete`, the briefing is re-fetched and the timer resets.

- [ ] **Step 1: Create the game shell**

Create `public/game.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Neon Syndicate</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #030712; color: #e5e7eb;
      font-family: monospace; font-size: 12px;
      height: 100vh; display: flex; flex-direction: column; overflow: hidden;
    }

    /* ── TOP BAR ─────────────────────────────────────────────────────── */
    #top-bar {
      background: #0a0d14; border-bottom: 1px solid #1e2a3a;
      height: 38px; display: flex; align-items: center;
      padding: 0 14px; gap: 10px; flex-shrink: 0; overflow: hidden;
    }
    #corp-name { color: #00f5c4; font-weight: bold; letter-spacing: 1px; font-size: 12px; white-space: nowrap; }
    .tb-sep { color: #1e2a3a; }
    .tb-res { color: #9ca3af; white-space: nowrap; }
    .tb-res span { color: #e5e7eb; }
    #rep-label { white-space: nowrap; }
    #rep-trusted   { color: #4ade80; }
    #rep-neutral   { color: #9ca3af; }
    #rep-notorious { color: #f97316; }
    #rep-pariah    { color: #ef4444; }
    #val-display { white-space: nowrap; }
    #val-display span { color: #ffd700; }

    /* Tick timer */
    #timer-area { margin-left: auto; display: flex; align-items: center; gap: 8px; white-space: nowrap; flex-shrink: 0; }
    #timer-label { color: #6b7280; font-size: 10px; }
    #timer-value { color: #fff; font-size: 12px; min-width: 40px; text-align: right; }
    #timer-bar-wrap { width: 80px; height: 4px; background: #1e2a3a; border-radius: 2px; overflow: hidden; }
    #timer-bar { height: 100%; background: #00f5c4; border-radius: 2px; width: 100%; transition: width 1s linear; }
    #tick-counter { color: #4b5563; font-size: 10px; }
    #ws-status { font-size: 10px; color: #22c55e; }
    #ws-reconnecting { font-size: 10px; color: #f59e0b; display: none; }

    /* ── MAIN AREA ───────────────────────────────────────────────────── */
    #main { flex: 1; display: flex; overflow: hidden; position: relative; }

    /* ── MAP AREA ────────────────────────────────────────────────────── */
    #map-area { flex: 1; position: relative; overflow: hidden; }
    #city-svg { width: 100%; height: 100%; }

    /* ── SIDE PANEL ──────────────────────────────────────────────────── */
    #side-panel {
      width: 0; overflow: hidden;
      background: #0a1220; border-left: 1px solid #00f5c4;
      transition: width 0.2s ease; display: flex; flex-direction: column;
      flex-shrink: 0;
    }
    #side-panel.open { width: 240px; }
    #side-inner { width: 240px; padding: 12px; display: flex; flex-direction: column; gap: 10px; height: 100%; overflow-y: auto; }

    /* ── LOG PANEL ───────────────────────────────────────────────────── */
    #log-panel { flex-shrink: 0; background: #0a0d14; border-top: 1px solid #1e2a3a; }
    #log-tab-bar {
      display: flex; align-items: center; height: 32px; padding: 0 14px; gap: 0;
      cursor: pointer;
    }
    .log-tab {
      padding: 0 14px; height: 100%; display: flex; align-items: center;
      color: #4b5563; font-size: 10px; letter-spacing: 1px; cursor: pointer;
      border-bottom: 2px solid transparent;
    }
    .log-tab:hover { color: #9ca3af; }
    .log-tab.active { color: #00f5c4; border-bottom-color: #00f5c4; }
    .log-badge {
      background: #1e3a2a; color: #00f5c4; font-size: 9px;
      padding: 1px 5px; border-radius: 8px; margin-left: 5px; display: none;
    }
    #log-body { height: 0; overflow: hidden; transition: height 0.2s ease; }
    #log-body.open { height: 220px; overflow-y: auto; }
    .log-pane { display: none; padding: 10px 14px; height: 100%; overflow-y: auto; }
    .log-pane.active { display: block; }
    .log-narrative { color: #9ca3af; font-size: 11px; line-height: 1.6; white-space: pre-wrap; }
    .log-event { color: #6b7280; font-size: 10px; padding: 3px 0; border-bottom: 1px solid #111827; }
    .log-event-new { color: #9ca3af; }

    /* ── OVERLAYS ────────────────────────────────────────────────────── */
    #overlay {
      position: absolute; inset: 0; background: #030712cc;
      display: flex; align-items: center; justify-content: center;
      z-index: 10; flex-direction: column; gap: 12px;
    }
    #overlay h2 { color: #00f5c4; font-size: 14px; letter-spacing: 3px; }
    #overlay p  { color: #6b7280; font-size: 11px; }
    #overlay.hidden { display: none; }

    /* Side panel inner styles */
    .sp-section { border-bottom: 1px solid #1e2a3a; padding-bottom: 10px; }
    .sp-label { color: #374151; font-size: 9px; letter-spacing: 1px; margin-bottom: 4px; }
    .sp-name { color: #fff; font-size: 14px; font-weight: bold; }
    .sp-sub  { color: #6b7280; font-size: 10px; margin-top: 2px; }
    .sp-owner-yours { color: #00f5c4; }
    .sp-owner-rival { color: #ff4d64; }
    .sp-owner-none  { color: #4b5563; }
    .sp-stat { display: flex; justify-content: space-between; font-size: 10px; color: #9ca3af; margin-bottom: 3px; }
    .sp-stat span { color: #e5e7eb; }
    .fort-bar { height: 4px; background: #1e2a3a; border-radius: 2px; margin-top: 3px; }
    .fort-fill { height: 100%; background: #ffd700; border-radius: 2px; }
    .sp-adj-ok   { color: #4ade80; font-size: 10px; }
    .sp-adj-no   { color: #4b5563; font-size: 10px; }

    /* Action buttons */
    .action-btn {
      width: 100%; padding: 8px; border-radius: 4px; cursor: pointer;
      font-family: monospace; font-size: 11px; font-weight: bold;
      border: 1px solid; text-align: center; margin-bottom: 5px;
      letter-spacing: 0.5px;
    }
    .action-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .action-claim    { background: #00f5c415; border-color: #00f5c4; color: #00f5c4; }
    .action-attack   { background: #ff4d6415; border-color: #ff4d64; color: #ff4d64; }
    .action-fortify  { background: #ffd70015; border-color: #ffd700; color: #ffd700; }
    .action-sabotage { background: #a855f715; border-color: #a855f7; color: #a855f7; }
    .action-leak     { background: #f9731615; border-color: #f97316; color: #f97316; }
    .action-queued   { background: #14532d; border-color: #22c55e; color: #22c55e; cursor: default; }
    .action-unavail  { background: #0f172a; border-color: #1e2a3a; color: #374151; cursor: not-allowed; }
    .unavail-reason  { font-size: 9px; font-weight: normal; display: block; margin-top: 2px; }

    /* Attack slider */
    #attack-slider-wrap { display: none; padding: 8px; background: #0f1a2a; border-radius: 4px; margin-bottom: 5px; }
    #attack-energy-slider { width: 100%; accent-color: #ff4d64; }
    #attack-readout { font-size: 10px; color: #9ca3af; margin-top: 6px; }
    #attack-confirm { display: none; }

    .sp-close { color: #374151; font-size: 9px; text-align: center; margin-top: auto; padding-top: 8px; cursor: pointer; }
    .sp-close:hover { color: #9ca3af; }

    /* Messages tab */
    .msg-item { padding: 6px 0; border-bottom: 1px solid #111827; }
    .msg-from { color: #6366f1; font-size: 10px; }
    .msg-text { color: #9ca3af; font-size: 11px; margin-top: 2px; }
    .alliance-row { display: flex; gap: 6px; align-items: center; padding: 6px 0; border-bottom: 1px solid #111827; }
    .alliance-name { flex: 1; color: #9ca3af; font-size: 10px; }
    .btn-accept { background: #14532d; border: 1px solid #22c55e; color: #22c55e; padding: 3px 8px; cursor: pointer; font-family: monospace; font-size: 10px; border-radius: 3px; }
    .btn-decline { background: #1f0a0a; border: 1px solid #ef4444; color: #ef4444; padding: 3px 8px; cursor: pointer; font-family: monospace; font-size: 10px; border-radius: 3px; }
    .msg-compose { margin-top: 10px; }
    .msg-compose label { color: #4b5563; font-size: 9px; display: block; margin-bottom: 3px; }
    .msg-compose select, .msg-compose textarea, .msg-compose input {
      background: #030712; border: 1px solid #1e2a3a; color: #e5e7eb;
      padding: 5px; width: 100%; font-family: monospace; font-size: 11px;
      border-radius: 3px; margin-bottom: 6px;
    }
    .msg-compose textarea { height: 50px; resize: none; }
    .btn-send {
      background: #1f1f3a; border: 1px solid #6366f1; color: #a78bfa;
      padding: 5px; width: 100%; cursor: pointer; font-family: monospace;
      font-size: 10px; border-radius: 3px;
    }
    .btn-send:hover { background: #2d1f6e; }
  </style>
</head>
<body>

<!-- TOP BAR -->
<div id="top-bar">
  <span id="corp-name">LOADING…</span>
  <span class="tb-sep">|</span>
  <span class="tb-res">VAL <span id="tb-val">–</span></span>
  <span class="tb-sep">|</span>
  <span class="tb-res">⚡ <span id="tb-energy">–</span></span>
  <span class="tb-res">💰 <span id="tb-credits">–</span></span>
  <span class="tb-res">👷 <span id="tb-workforce">–</span></span>
  <span class="tb-res">🔍 <span id="tb-intel">–</span></span>
  <span class="tb-res">🎭 <span id="tb-influence">–</span></span>
  <span class="tb-res">🏛 <span id="tb-polpower">–</span></span>
  <span class="tb-sep">|</span>
  <span id="rep-label">REP <span id="tb-rep">–</span></span>

  <div id="timer-area">
    <span id="ws-status">●</span>
    <span id="ws-reconnecting">RECONNECTING…</span>
    <span id="timer-label">NEXT TICK</span>
    <span id="timer-value">–</span>
    <div id="timer-bar-wrap"><div id="timer-bar"></div></div>
    <span id="tick-counter">TICK –/–</span>
  </div>
</div>

<!-- MAIN AREA: map + side panel -->
<div id="main">
  <div id="map-area">
    <!-- SVG map inserted by Task 7 -->
    <svg id="city-svg" viewBox="0 0 900 540" preserveAspectRatio="xMidYMid meet"></svg>
  </div>

  <!-- SIDE PANEL -->
  <div id="side-panel">
    <div id="side-inner">
      <div class="sp-section">
        <div class="sp-label">DISTRICT</div>
        <div class="sp-name" id="sp-name">–</div>
        <div class="sp-sub" id="sp-sub">–</div>
      </div>
      <div class="sp-section">
        <div class="sp-stat">YIELD / TICK <span id="sp-yield">–</span></div>
        <div class="sp-stat">FORTIFICATION
          <span id="sp-fort-val">0 / 20</span>
        </div>
        <div class="fort-bar"><div class="fort-fill" id="sp-fort-bar" style="width:0%"></div></div>
      </div>
      <div class="sp-section" id="sp-adj-section">
        <div id="sp-adj-status"></div>
      </div>
      <div id="sp-actions">
        <!-- Populated dynamically -->
      </div>
      <div class="sp-close" id="sp-close-btn">ESC to close</div>
    </div>
  </div>
</div>

<!-- LOG PANEL -->
<div id="log-panel">
  <div id="log-tab-bar">
    <div class="log-tab active" data-tab="narrative" onclick="switchLogTab('narrative')">
      NARRATIVE <span class="log-badge" id="badge-narrative"></span>
    </div>
    <div class="log-tab" data-tab="events" onclick="switchLogTab('events')">
      EVENTS <span class="log-badge" id="badge-events"></span>
    </div>
    <div class="log-tab" data-tab="messages" onclick="switchLogTab('messages')">
      MESSAGES <span class="log-badge" id="badge-messages"></span>
    </div>
    <span style="margin-left:auto;color:#374151;font-size:10px;padding-right:4px" id="log-toggle-btn" onclick="toggleLog()">▲ EXPAND</span>
  </div>
  <div id="log-body">
    <div class="log-pane active" id="pane-narrative">
      <div class="log-narrative" id="narrative-text">Waiting for first tick…</div>
    </div>
    <div class="log-pane" id="pane-events">
      <div id="events-list"></div>
    </div>
    <div class="log-pane" id="pane-messages">
      <div id="messages-list"></div>
      <div class="msg-compose">
        <div style="color:#374151;font-size:9px;letter-spacing:1px;margin-bottom:8px">SEND MESSAGE</div>
        <label>TO CORP</label>
        <select id="msg-to-corp"><option value="">Select…</option></select>
        <label>MESSAGE</label>
        <textarea id="msg-text" placeholder="Your message…"></textarea>
        <button class="btn-send" onclick="sendMessage()">SEND</button>
      </div>
    </div>
  </div>
</div>

<!-- OVERLAY (pending/ended season) -->
<div id="overlay" class="hidden">
  <h2 id="overlay-title">LOADING</h2>
  <p id="overlay-body"></p>
</div>

<script>
// ── Auth check ────────────────────────────────────────────────────────────────
const AGENT_ID = localStorage.getItem('ns_agent_id');
const API_KEY  = localStorage.getItem('ns_api_key');
if (!AGENT_ID || !API_KEY) { window.location.href = '/play'; }

// ── Corp color palette (matches registration order from GET /world) ────────────
const CORP_COLORS = ['#00f5c4','#ff4d64','#ffd700','#a855f7','#3b82f6','#f97316','#10b981','#ec4899'];
const corpColorMap = {}; // corpId → color, populated from world data

// ── State ─────────────────────────────────────────────────────────────────────
let briefing = null;
let worldData = null;
let selectedDistrictId = null;
let queuedActionTick = null; // tick number when action was submitted
let logExpanded = false;
let nextTickAt = 0;
let tickIntervalMs = 60000;
let timerInterval = null;

// ── Fetch helpers ──────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

// ── Load world (for corp colors + district list) ───────────────────────────────
async function loadWorld() {
  try {
    const res = await fetch('/world');
    if (!res.ok) return;
    worldData = await res.json();
    // Assign colors by registration order (array index)
    worldData.corporations.forEach((c, i) => {
      corpColorMap[c.id] = CORP_COLORS[i % CORP_COLORS.length];
    });
    populateCorpDropdown();
    renderMap();
  } catch (_) {}
}

// ── Load briefing ──────────────────────────────────────────────────────────────
async function loadBriefing() {
  try {
    const res = await apiFetch(`/briefing/${AGENT_ID}`);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) { localStorage.clear(); window.location.href = '/play'; }
      return;
    }
    briefing = await res.json();
    if (briefing.generating) { setTimeout(loadBriefing, 3000); return; }
    updateTopBar();
    updateOverlay();
    if (briefing.nextTickAt && briefing.nextTickAt > 0) {
      startTimer(briefing.nextTickAt);
    }
    updateLogPanel();
    if (selectedDistrictId) renderSidePanel(selectedDistrictId);
  } catch (_) {}
}

// ── Top bar ────────────────────────────────────────────────────────────────────
function updateTopBar() {
  if (!briefing) return;
  document.getElementById('corp-name').textContent = briefing.resources ? getCorporationName() : 'NEON SYNDICATE';
  document.getElementById('tb-val').textContent       = briefing.valuation != null ? briefing.valuation.toLocaleString() : '–';
  document.getElementById('tb-energy').textContent    = briefing.resources?.energy ?? '–';
  document.getElementById('tb-credits').textContent   = briefing.resources?.credits ?? '–';
  document.getElementById('tb-workforce').textContent = briefing.resources?.workforce ?? '–';
  document.getElementById('tb-intel').textContent     = briefing.resources?.intelligence ?? '–';
  document.getElementById('tb-influence').textContent = briefing.resources?.influence ?? '–';
  document.getElementById('tb-polpower').textContent  = briefing.resources?.politicalPower ?? '–';
  // worldData.tick = current tick; season_length not exposed by /world, so show tick only
  document.getElementById('tick-counter').textContent = briefing.tick != null
    ? `TICK ${briefing.tick}` : 'TICK –';

  const repEl = document.getElementById('tb-rep');
  repEl.className = '';
  const label = briefing.reputationLabel || '';
  repEl.textContent = label;
  if      (label === 'Trusted')   repEl.className = 'rep-trusted';
  else if (label === 'Notorious') repEl.className = 'rep-notorious';
  else if (label === 'Pariah')    repEl.className = 'rep-pariah';
  else                            repEl.className = 'rep-neutral';
}

function getCorporationName() {
  if (!worldData) return 'YOUR CORP';
  const me = worldData.corporations.find(c => c.id === AGENT_ID);
  return me ? me.name.toUpperCase() : 'YOUR CORP';
}

// ── Overlay ────────────────────────────────────────────────────────────────────
function updateOverlay() {
  if (!worldData) return;
  const overlay = document.getElementById('overlay');
  if (worldData.type === 'world_state' && worldData.tick === 0 && worldData.corporations.length === 0) {
    overlay.classList.remove('hidden');
    document.getElementById('overlay-title').textContent = 'NO ACTIVE SEASON';
    document.getElementById('overlay-body').textContent = 'Ask the admin to create and activate a season.';
  } else {
    overlay.classList.add('hidden');
  }
}

// ── Tick timer ─────────────────────────────────────────────────────────────────
function startTimer(targetMs) {
  nextTickAt = targetMs;
  if (timerInterval) clearInterval(timerInterval);
  tickIntervalMs = worldData?.tick_interval_ms || 60000;

  function tick() {
    const now = Date.now();
    const remaining = Math.max(0, nextTickAt - now);
    const secs = Math.ceil(remaining / 1000);
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    document.getElementById('timer-value').textContent =
      briefing?.generating ? 'Processing…' : `${mins}:${String(s).padStart(2,'0')}`;
    const pct = Math.min(100, Math.max(0, (remaining / tickIntervalMs) * 100));
    document.getElementById('timer-bar').style.width = pct + '%';
    document.getElementById('timer-bar').style.background = pct < 15 ? '#ef4444' : '#00f5c4';
  }
  tick();
  timerInterval = setInterval(tick, 500);
}

// ── Log panel ──────────────────────────────────────────────────────────────────
function toggleLog() {
  logExpanded = !logExpanded;
  document.getElementById('log-body').className = logExpanded ? 'open' : '';
  document.getElementById('log-toggle-btn').textContent = logExpanded ? '▼ COLLAPSE' : '▲ EXPAND';
}

function switchLogTab(tab) {
  document.querySelectorAll('.log-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  document.querySelectorAll('.log-pane').forEach(el => {
    el.classList.toggle('active', el.id === `pane-${tab}`);
  });
  document.getElementById(`badge-${tab}`).style.display = 'none';
}

function updateLogPanel() {
  if (!briefing) return;
  // Narrative
  const narrativeEl = document.getElementById('narrative-text');
  if (briefing.narrative) {
    narrativeEl.textContent = briefing.narrative;
    showBadge('narrative');
  }
  // Events
  const eventsEl = document.getElementById('events-list');
  if (briefing.events?.length) {
    eventsEl.innerHTML = briefing.events.map(e =>
      `<div class="log-event log-event-new">${esc(e)}</div>`
    ).join('');
    showBadge('events');
  }
  // Messages + pending alliances
  renderMessages();
}

function renderMessages() {
  if (!briefing) return;
  const el = document.getElementById('messages-list');
  let html = '';
  // Pending alliance proposals
  (briefing.pendingAlliances || []).forEach(pa => {
    html += `<div class="alliance-row">
      <span class="alliance-name">⭐ Alliance proposal from <b>${esc(pa.proposing_corp_name)}</b></span>
      <button class="btn-accept" onclick="respondAlliance('${pa.proposing_corp_id}','accept')">ACCEPT</button>
      <button class="btn-decline" onclick="respondAlliance('${pa.proposing_corp_id}','decline')">DECLINE</button>
    </div>`;
  });
  // Messages received
  (briefing.messages || []).forEach(m => {
    const fromCorp = worldData?.corporations.find(c => c.id === m.from_corp_id);
    html += `<div class="msg-item">
      <div class="msg-from">${esc(fromCorp?.name || m.from_corp_id)}</div>
      <div class="msg-text">${esc(m.text)}</div>
    </div>`;
  });
  if (!html) html = '<div style="color:#374151;font-size:10px;padding:8px 0">No messages this tick</div>';
  el.innerHTML = html;
  if (briefing.messages?.length || briefing.pendingAlliances?.length) showBadge('messages');
}

function showBadge(tab) {
  const activeTab = document.querySelector('.log-tab.active')?.dataset.tab;
  if (activeTab !== tab) {
    document.getElementById(`badge-${tab}`).style.display = 'inline';
  }
}

function populateCorpDropdown() {
  if (!worldData) return;
  const sel = document.getElementById('msg-to-corp');
  sel.innerHTML = '<option value="">Select…</option>';
  worldData.corporations
    .filter(c => c.id !== AGENT_ID)
    .forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
}

async function sendMessage() {
  const toCorpId = document.getElementById('msg-to-corp').value;
  const text = document.getElementById('msg-text').value.trim();
  if (!toCorpId || !text) return;
  await submitFreeAction({ type: 'message', toCorpId, text });
  document.getElementById('msg-text').value = '';
}

async function respondAlliance(corpId, decision) {
  await submitFreeAction({ type: `${decision}_alliance`, targetCorpId: corpId });
  await loadBriefing();
}

// ── Side panel ─────────────────────────────────────────────────────────────────
function openSidePanel(districtId) {
  selectedDistrictId = districtId;
  document.getElementById('side-panel').classList.add('open');
  renderSidePanel(districtId);
}

function closeSidePanel() {
  selectedDistrictId = null;
  document.getElementById('side-panel').classList.remove('open');
  document.querySelectorAll('.district-poly').forEach(p => p.classList.remove('selected'));
}

document.getElementById('sp-close-btn').addEventListener('click', closeSidePanel);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidePanel(); });

function renderSidePanel(districtId) {
  const district = worldData?.districts.find(d => d.id === districtId);
  if (!district) return;

  const isOwned    = !!district.ownerId;
  const isMine     = district.ownerId === AGENT_ID;
  const isRival    = isOwned && !isMine;
  const isAdjacent = (briefing?.holdings || []).some(h =>
    (h.adjacent_ids || []).includes(districtId)
  );

  document.getElementById('sp-name').textContent = district.name;

  const typeLabel = { power_grid:'Power Grid', financial_hub:'Financial Hub', labor_zone:'Labor Zone',
    data_center:'Data Center', black_market:'Black Market', government_quarter:'Gov\'t Quarter' };
  const ownerText = isMine ? 'Owned by you' : (isOwned ? `Owned by ${district.ownerName}` : 'Unclaimed');
  const ownerClass = isMine ? 'sp-owner-yours' : (isOwned ? 'sp-owner-rival' : 'sp-owner-none');
  document.getElementById('sp-sub').innerHTML =
    `${typeLabel[district.type] || district.type} · <span class="${ownerClass}">${esc(ownerText)}</span>`;

  // Yield
  const yieldMap = { power_grid:'+4 ⚡ energy', financial_hub:'+4 💰 credits',
    labor_zone:'+3 👷 workforce', data_center:'+3 🔍 intelligence',
    black_market:'+2 🎭 influence', government_quarter:'+3 🏛 pol.power' };
  document.getElementById('sp-yield').textContent = yieldMap[district.type] || '?';

  // Fortification
  const fortPct = Math.round((district.fortificationLevel / 20) * 100);
  document.getElementById('sp-fort-val').textContent = `${district.fortificationLevel} / 20`;
  document.getElementById('sp-fort-bar').style.width = fortPct + '%';

  // Adjacency
  document.getElementById('sp-adj-status').innerHTML = isAdjacent
    ? `<span class="sp-adj-ok">✓ Adjacent to your district</span>`
    : `<span class="sp-adj-no">✗ Not adjacent to your holdings</span>`;

  // Actions
  renderActionButtons(district, isMine, isRival, isAdjacent);
}

// YIELD type icons for display
const DISTRICT_ICONS = {
  power_grid:'⚡', financial_hub:'💰', labor_zone:'👷',
  data_center:'🔍', black_market:'🎭', government_quarter:'🏛'
};

function renderActionButtons(district, isMine, isRival, isAdjacent) {
  const r = briefing?.resources || {};
  const actionsTick = briefing?.tick ?? -1;
  const isQueued = queuedActionTick === actionsTick;
  const container = document.getElementById('sp-actions');

  // Hide attack slider by default
  hideAttackSlider();

  if (isQueued) {
    container.innerHTML = `<div class="action-btn action-queued">✓ ACTION QUEUED FOR TICK ${actionsTick}</div>`;
    return;
  }

  let html = '<div class="sp-label" style="margin-bottom:6px">ACTIONS</div>';

  // CLAIM — unclaimed + adjacent
  if (!district.ownerId) {
    if (isAdjacent && r.energy >= 3 && r.credits >= 5) {
      html += `<button class="action-btn action-claim" onclick="submitPrimary({type:'claim',targetDistrictId:'${district.id}'})">CLAIM  ·  3⚡ 5💰</button>`;
    } else if (!isAdjacent) {
      html += `<div class="action-btn action-unavail">CLAIM<span class="unavail-reason">not adjacent to your holdings</span></div>`;
    } else {
      html += `<div class="action-btn action-unavail">CLAIM<span class="unavail-reason">insufficient resources (need 3⚡ 5💰)</span></div>`;
    }
  }

  // FORTIFY — mine, fort < 20
  if (isMine) {
    if (district.fortificationLevel < 20 && r.energy >= 2 && r.credits >= 8) {
      html += `<button class="action-btn action-fortify" onclick="submitPrimary({type:'fortify',targetDistrictId:'${district.id}'})">FORTIFY  ·  2⚡ 8💰  (+5 fort)</button>`;
    } else if (district.fortificationLevel >= 20) {
      html += `<div class="action-btn action-unavail">FORTIFY<span class="unavail-reason">already at max fortification (20)</span></div>`;
    } else {
      html += `<div class="action-btn action-unavail">FORTIFY<span class="unavail-reason">insufficient resources (need 2⚡ 8💰)</span></div>`;
    }
  }

  // ATTACK — rival-owned
  if (isRival) {
    if (r.energy >= 5 && r.credits >= 10) {
      html += `<button class="action-btn action-attack" id="attack-btn" onclick="toggleAttackSlider('${district.id}')">ATTACK  ·  5⚡+ 10💰  −3 rep</button>`;
    } else {
      html += `<div class="action-btn action-unavail">ATTACK<span class="unavail-reason">insufficient resources (need 5⚡ 10💰)</span></div>`;
    }
  }

  // SABOTAGE — rival-owned, influence >= 5
  if (isRival) {
    if (r.energy >= 4 && r.credits >= 15 && r.influence >= 5) {
      html += `<button class="action-btn action-sabotage" onclick="submitPrimary({type:'sabotage',targetDistrictId:'${district.id}'})">SABOTAGE  ·  4⚡ 15💰 5🎭  −5 rep</button>`;
    } else {
      const reason = r.influence < 5 ? 'requires influence ≥ 5' : 'insufficient resources';
      html += `<div class="action-btn action-unavail">SABOTAGE<span class="unavail-reason">${reason}</span></div>`;
    }
  }

  // LEAK SCANDAL — rival-owned, influence >= 5 (targets owning corp)
  if (isRival) {
    if (r.energy >= 2 && r.credits >= 10 && r.influence >= 5) {
      html += `<button class="action-btn action-leak" onclick="submitPrimary({type:'leak_scandal',targetCorpId:'${district.ownerId}'})">LEAK SCANDAL  ·  2⚡ 10💰 5🎭  −3 rep</button>`;
    } else {
      const reason = r.influence < 5 ? 'requires influence ≥ 5' : 'insufficient resources';
      html += `<div class="action-btn action-unavail">LEAK SCANDAL<span class="unavail-reason">${reason}</span></div>`;
    }
  }

  container.innerHTML = html;

  // Attach attack slider after insertion
  if (isRival && r.energy >= 5) {
    const sliderWrap = document.createElement('div');
    sliderWrap.id = 'attack-slider-wrap';
    sliderWrap.innerHTML = `
      <div style="color:#6b7280;font-size:9px;margin-bottom:4px">ENERGY TO SPEND (min 5)</div>
      <input type="range" id="attack-energy-slider" min="5" max="${r.energy}" value="5" oninput="updateAttackReadout(${district.fortificationLevel})">
      <div id="attack-readout">Attack: — · Est. defense: —</div>
      <button class="action-btn action-attack" id="attack-confirm" style="margin-top:6px;display:none" onclick="confirmAttack('${district.id}')">CONFIRM ATTACK</button>
    `;
    const attackBtn = document.getElementById('attack-btn');
    if (attackBtn) attackBtn.after(sliderWrap);
  }
}

function toggleAttackSlider(districtId) {
  const wrap = document.getElementById('attack-slider-wrap');
  if (!wrap) return;
  const isVisible = wrap.style.display === 'block';
  wrap.style.display = isVisible ? 'none' : 'block';
  document.getElementById('attack-confirm').style.display = isVisible ? 'none' : 'block';
  if (!isVisible) {
    const district = worldData?.districts.find(d => d.id === districtId);
    updateAttackReadout(district?.fortificationLevel || 0);
  }
}

function hideAttackSlider() {
  const wrap = document.getElementById('attack-slider-wrap');
  if (wrap) { wrap.style.display = 'none'; }
  const confirm = document.getElementById('attack-confirm');
  if (confirm) { confirm.style.display = 'none'; }
}

function updateAttackReadout(fortLevel) {
  const slider = document.getElementById('attack-energy-slider');
  const readout = document.getElementById('attack-readout');
  if (!slider || !readout) return;
  const energy = parseInt(slider.value);
  const myWorkforce = briefing?.resources?.workforce || 0;
  const attackStr = Math.round(energy * 1.5 + myWorkforce);
  const estDefense = fortLevel + 5; // rough estimate (workforce unknown for rival)
  const likely = attackStr > estDefense ? '✓ likely WIN' : '⚠ may LOSE';
  readout.textContent = `Attack: ${attackStr}  ·  Est. defense: ${estDefense}  ·  ${likely}`;
  readout.style.color = attackStr > estDefense ? '#4ade80' : '#f97316';
}

function confirmAttack(districtId) {
  const slider = document.getElementById('attack-energy-slider');
  if (!slider) return;
  submitPrimary({ type: 'attack', targetDistrictId: districtId, energySpent: parseInt(slider.value) });
}

// ── Action submission ──────────────────────────────────────────────────────────
async function submitPrimary(primaryAction) {
  const currentTick = briefing?.tick ?? 0;
  try {
    const res = await apiFetch(`/action/${AGENT_ID}`, {
      method: 'POST',
      body: JSON.stringify({ actions: { primaryAction, freeActions: [] } }),
    });
    if (res.ok) {
      queuedActionTick = currentTick;
      if (selectedDistrictId) renderSidePanel(selectedDistrictId);
    }
  } catch (_) {}
}

async function submitFreeAction(freeAction) {
  try {
    await apiFetch(`/action/${AGENT_ID}`, {
      method: 'POST',
      body: JSON.stringify({ actions: { primaryAction: null, freeActions: [freeAction] } }),
    });
  } catch (_) {}
}

// ── SVG city map ───────────────────────────────────────────────────────────────
// District polygon coordinates keyed by name.
// Layout: 6 cols × 4 rows, irregular quads sharing exact edge vertices.
// Vertex grid (col 0–6, row 0–4):
//   row 0: (10,10) (155,5)  (300,15) (445,8)  (595,12) (745,5)  (890,10)
//   row 1: (10,140)(148,135)(298,148)(448,142)(592,138)(745,145)(890,140)
//   row 2: (10,278)(152,272)(295,280)(450,275)(594,282)(742,270)(890,278)
//   row 3: (10,412)(150,408)(300,415)(445,410)(590,418)(740,408)(890,412)
//   row 4: (10,530)(150,530)(300,530)(450,530)(592,530)(742,530)(890,530)
// Each polygon is [TL, TR, BR, BL] as "x,y" strings.

const DISTRICT_POLYGONS = {
  'Northgate':            [[10,10],[155,5],[148,135],[10,140]],
  'Chrome Quarter':       [[155,5],[300,15],[298,148],[148,135]],
  'Data Row':             [[300,15],[445,8],[448,142],[298,148]],
  'Midtown':              [[445,8],[595,12],[592,138],[448,142]],
  'Neon Strip':           [[595,12],[745,5],[745,145],[592,138]],
  'East Docks':           [[745,5],[890,10],[890,140],[745,145]],
  'The Sprawl':           [[10,140],[148,135],[152,272],[10,278]],
  'Ironworks':            [[148,135],[298,148],[295,280],[152,272]],
  'Government Hill':      [[298,148],[448,142],[450,275],[295,280]],
  'Shadowmarket':         [[448,142],[592,138],[594,282],[450,275]],
  'Westside':             [[592,138],[745,145],[742,270],[594,282]],
  'Harbor Gate':          [[745,145],[890,140],[890,278],[742,270]],
  'Undervault':           [[10,278],[152,272],[150,408],[10,412]],
  'Power Station Alpha':  [[152,272],[295,280],[300,415],[150,408]],
  'Labor Yards':          [[295,280],[450,275],[445,410],[300,415]],
  'Synapse Hub':          [[450,275],[594,282],[590,418],[445,410]],
  'Old Town':             [[594,282],[742,270],[740,408],[590,418]],
  'Redline':              [[742,270],[890,278],[890,412],[740,408]],
  'Blacksite':            [[10,412],[150,408],[150,530],[10,530]],
  'The Exchange':         [[150,408],[300,415],[300,530],[150,530]],
  'Southgate':            [[300,415],[445,410],[450,530],[300,530]],
  'Circuit Row':          [[445,410],[590,418],[592,530],[450,530]],
  'Power Station Beta':   [[590,418],[740,408],[742,530],[592,530]],
  'Deep Market':          [[740,408],[890,412],[890,530],[742,530]],
};

function pointsStr(coords) {
  return coords.map(([x,y]) => `${x},${y}`).join(' ');
}

function centroid(coords) {
  const x = coords.reduce((s,[cx]) => s+cx, 0) / coords.length;
  const y = coords.reduce((s,[,cy]) => s+cy, 0) / coords.length;
  return [Math.round(x), Math.round(y)];
}

function renderMap() {
  const svg = document.getElementById('city-svg');
  const districts = worldData?.districts || [];

  svg.innerHTML = '';

  // Draw adjacency lines first (beneath polygons)
  const districtById = {};
  districts.forEach(d => { districtById[d.id] = d; });
  const drawnEdges = new Set();

  districts.forEach(d => {
    const coords = DISTRICT_POLYGONS[d.name];
    if (!coords) return;
    const [cx, cy] = centroid(coords);
    (d.adjacentIds || []).forEach(adjId => {
      const edgeKey = [d.id, adjId].sort().join('|');
      if (drawnEdges.has(edgeKey)) return;
      drawnEdges.add(edgeKey);
      const adj = districtById[adjId];
      if (!adj) return;
      const adjCoords = DISTRICT_POLYGONS[adj.name];
      if (!adjCoords) return;
      const [ax, ay] = centroid(adjCoords);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', cx); line.setAttribute('y1', cy);
      line.setAttribute('x2', ax); line.setAttribute('y2', ay);
      line.setAttribute('stroke', '#0d1f30');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
    });
  });

  // Draw district polygons
  districts.forEach(d => {
    const coords = DISTRICT_POLYGONS[d.name];
    if (!coords) return;

    const isMine  = d.ownerId === AGENT_ID;
    const isOwned = !!d.ownerId;
    const color   = isOwned ? (corpColorMap[d.ownerId] || '#888') : '#1a2535';
    const strokeColor = isOwned ? color : '#2a3a4a';
    const strokeWidth = isMine ? 2 : 1;
    const fillOpacity = isMine ? 0.35 : (isOwned ? 0.2 : 0.8);

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', pointsStr(coords));
    poly.setAttribute('fill', color);
    poly.setAttribute('fill-opacity', fillOpacity);
    poly.setAttribute('stroke', strokeColor);
    poly.setAttribute('stroke-width', strokeWidth);
    poly.setAttribute('class', `district-poly${isMine ? ' district-mine' : ''}`);
    poly.dataset.districtId = d.id;
    poly.style.cursor = 'pointer';
    poly.style.transition = 'fill-opacity 0.4s, stroke 0.4s';

    poly.addEventListener('mouseenter', () => {
      if (selectedDistrictId !== d.id) poly.setAttribute('fill-opacity', 0.6);
      showTooltip(d, coords);
    });
    poly.addEventListener('mouseleave', () => {
      if (selectedDistrictId !== d.id) poly.setAttribute('fill-opacity', fillOpacity);
      hideTooltip();
    });
    poly.addEventListener('click', () => {
      document.querySelectorAll('.district-poly').forEach(p => p.classList.remove('selected'));
      poly.classList.add('selected');
      poly.setAttribute('stroke', '#fff');
      poly.setAttribute('stroke-width', 3);
      openSidePanel(d.id);
    });

    svg.appendChild(poly);

    // District type icon
    const [cx, cy] = centroid(coords);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    icon.setAttribute('x', cx);
    icon.setAttribute('y', cy + 4);
    icon.setAttribute('text-anchor', 'middle');
    icon.setAttribute('font-size', '14');
    icon.setAttribute('pointer-events', 'none');
    icon.textContent = DISTRICT_ICONS[d.type] || '?';
    svg.appendChild(icon);
  });
}

// ── Tooltip ────────────────────────────────────────────────────────────────────
let tooltip = null;
function showTooltip(district, coords) {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.style.cssText = 'position:fixed;background:#0a0d14;border:1px solid #1e2a3a;border-radius:4px;padding:5px 8px;font-family:monospace;font-size:10px;color:#e5e7eb;pointer-events:none;z-index:20;white-space:nowrap';
    document.body.appendChild(tooltip);
  }
  const ownerText = district.ownerId === AGENT_ID ? 'Yours'
    : district.ownerName ? district.ownerName : 'Unclaimed';
  tooltip.textContent = `${district.name}  ·  ${ownerText}`;
  tooltip.style.display = 'block';
  document.addEventListener('mousemove', moveTooltip);
}
function moveTooltip(e) {
  if (tooltip) {
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top  = (e.clientY - 28) + 'px';
  }
}
function hideTooltip() {
  if (tooltip) { tooltip.style.display = 'none'; }
  document.removeEventListener('mousemove', moveTooltip);
}

// ── WebSocket ──────────────────────────────────────────────────────────────────
let ws = null;
let wsRetryTimeout = null;

function connectWs() {
  if (wsRetryTimeout) { clearTimeout(wsRetryTimeout); wsRetryTimeout = null; }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    document.getElementById('ws-status').style.color = '#22c55e';
    document.getElementById('ws-reconnecting').style.display = 'none';
  };

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'tick_complete') {
      // Reset queued action lock — new tick started
      queuedActionTick = null;
      if (msg.nextTickAt) startTimer(msg.nextTickAt);
      await loadWorld();
      await loadBriefing();
      // Flash log tab bar
      document.getElementById('log-tab-bar').style.borderTopColor = '#00f5c4';
      setTimeout(() => { document.getElementById('log-tab-bar').style.borderTopColor = ''; }, 800);
    }
  };

  ws.onclose = () => {
    document.getElementById('ws-status').style.color = '#374151';
    document.getElementById('ws-reconnecting').style.display = 'inline';
    wsRetryTimeout = setTimeout(connectWs, 5000);
  };
  ws.onerror = () => ws.close();
}

// ── Utilities ──────────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ───────────────────────────────────────────────────────────────────────
(async function boot() {
  await loadWorld();
  await loadBriefing();
  connectWs();
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Verify manually**

Start the server and open `http://localhost:3000/game`. With credentials saved from `/play`:
- Top bar shows corp name and all resources
- Tick timer counts down (or shows `–` before first tick)
- SVG map renders all 24 districts with color coding
- Hovering a district shows a tooltip
- Clicking a district opens the side panel with info and action buttons
- Log panel expands/collapses on click
- WebSocket dot is green

- [ ] **Step 3: Run the test suite to confirm server changes are still working**

```bash
npx jest --no-coverage 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add public/game.html
git commit -m "feat: add /game player view with map, side panel, and log panel"
```

---

## Chunk 3: End-to-end smoke test + final commit

### Task 7: End-to-end manual smoke test

**Files:** (none new)

This task validates the full flow works before declaring done.

- [ ] **Step 1: Start a fresh game**

```bash
# Reset DB and start fresh
rm -f neon.db
node src/index.js
```

- [ ] **Step 2: Create a season via admin**

Open `http://localhost:3000/admin`, enter admin key. Create a season with:
- Tick interval: 30 seconds
- Season length: 10 ticks
Activate it.

- [ ] **Step 3: Register as a human player**

Open `http://localhost:3000/play`. Register a new corp. Confirm you see the agentId + apiKey, then get redirected to `/game`.

- [ ] **Step 4: Verify game view**

In `/game` confirm:
- Corp name appears in top bar
- All resources show (starting: credits=10, energy=8, workforce=6, intel=4, influence=0, polpower=0)
- Tick timer is counting down
- 24 districts are visible on the map
- Your starting district is highlighted in your corp color

- [ ] **Step 5: Take an action**

Click an adjacent unclaimed district. Confirm:
- Side panel opens with district name, type, yield, "Adjacent" status
- CLAIM button shows with cost (3⚡ 5💰)
- Click CLAIM → button changes to "✓ ACTION QUEUED"
- Next tick fires → district changes color to your corp's color

- [ ] **Step 6: Register an AI agent in parallel**

In another terminal, POST to `/register` with a second corp name. Watch the second corp appear on the map with a different color.

- [ ] **Step 7: Verify tick timer resets on tick_complete**

Watch the timer — on each tick, confirm it resets to the full interval. Confirm narrative updates in the log panel.

- [ ] **Step 8: Run full test suite one final time**

```bash
npx jest --no-coverage 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "feat: human player UI complete — /play and /game with SVG map, side panel, tick timer"
```
