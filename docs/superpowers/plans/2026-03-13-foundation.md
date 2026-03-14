# Neon Syndicate — Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a running game server with a tick loop, SQLite database, and three REST API endpoints (register, briefing, action submission) so agents can join and receive briefings.

**Architecture:** Express.js REST server backed by better-sqlite3 (synchronous SQLite). A setInterval-based tick loop fires every N minutes, generates resources, and updates briefings. Action submissions are stored in the DB; resolution logic comes in Plan 2. Gemini integration (narrative briefings) comes in Plan 4 — for now, briefings return structured JSON only with `narrative: null`.

**Tech Stack:** Node.js 18+, Express 4, better-sqlite3 v9+ (bundles SQLite 3.45+), Jest, supertest, nodemon (dev)

**Spec:** `docs/superpowers/specs/2026-03-13-agent-game-design.md`

**Important:** `require('dotenv').config()` must be called before any other `require` in `src/index.js` so that `DB_PATH` and `TICK_INTERVAL_MS` are available when modules initialize.

---

## File Structure

```
src/
  db/
    index.js          - DB connection singleton (better-sqlite3, opens/creates neon.db)
    schema.js         - All CREATE TABLE statements; called once on startup
  game/
    valuation.js      - calculateValuation(corp, districtCount) — single source of truth
    world.js          - Creates a new season's 24-district map with adjacencies
    resources.js      - Resource generation per tick; Workforce enforcement
    tick.js           - Tick loop: fires every N ms, runs resource gen + briefing updates
  api/
    server.js         - Express app, middleware, route mounting
    auth.js           - Bearer token middleware (validates apiKey → sets req.corp)
    routes/
      register.js     - POST /register
      briefing.js     - GET /briefing/:agentId
      action.js       - POST /action/:agentId
  index.js            - Entry point: init DB, create server, start tick loop

tests/
  db/
    schema.test.js    - All tables created with correct columns
  game/
    world.test.js     - District map created with correct types, counts, adjacencies
    resources.test.js - Resource generation, Workforce enforcement
    tick.test.js      - Tick increments, resources updated, briefings stored
  api/
    register.test.js  - Registration happy path, duplicate name, closed season
    briefing.test.js  - Returns latest briefing; auth behavior
    action.test.js    - Stores action; auth required; overwrites previous

package.json
jest.config.js
.env.example
```

---

## Chunk 1: Project Setup + Database Schema

### Task 1: Initialize project

**Files:**
- Create: `package.json`
- Create: `jest.config.js`
- Create: `.env.example`
- Create: `src/index.js` (skeleton)

- [ ] **Step 1: Init npm project**

```bash
cd "C:\Users\jford\OneDrive\Projects\AgentGame"
npm init -y
```

Expected: `package.json` created.

- [ ] **Step 2: Install all dependencies (including dev)**

```bash
npm install express better-sqlite3@^9.0.0 uuid dotenv
npm install --save-dev jest nodemon supertest
```

Note: better-sqlite3 v9+ bundles SQLite 3.45+, which supports `strftime('%s','now')` used in the schema.

- [ ] **Step 3: Configure package.json scripts**

Edit `package.json` — replace the `scripts` section:

```json
"scripts": {
  "start": "node src/index.js",
  "dev": "nodemon src/index.js",
  "test": "jest --runInBand"
}
```

- [ ] **Step 4: Create jest.config.js**

```js
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
};
```

- [ ] **Step 5: Create .env.example**

```
# .env.example
PORT=3000
TICK_INTERVAL_MS=300000
DB_PATH=./neon.db
ADMIN_PASSWORD=changeme
```

- [ ] **Step 6: Create src/index.js skeleton**

```js
// src/index.js
// dotenv must load before any other require so DB_PATH etc. are available
require('dotenv').config();
const { initDb } = require('./db/schema');
const { createServer } = require('./api/server');
const { startTickLoop } = require('./game/tick');

async function main() {
  initDb();
  const app = createServer();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Neon Syndicate running on port ${port}`));
  startTickLoop();
}

main().catch(console.error);
```

- [ ] **Step 7: Commit**

```bash
git add package.json jest.config.js .env.example src/index.js
git commit -m "chore: initialize Neon Syndicate project"
```

---

### Task 2: Database schema

**Files:**
- Create: `src/db/index.js`
- Create: `src/db/schema.js`
- Create: `tests/db/schema.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/db/schema.test.js
const Database = require('better-sqlite3');
const { initDb } = require('../../src/db/schema');

let db;

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
});

afterEach(() => db.close());

const tables = [
  'seasons', 'districts', 'corporations', 'alliances',
  'events', 'messages', 'phases', 'laws', 'lobby_votes',
  'pending_actions', 'briefings',
];

test.each(tables)('table %s exists', (table) => {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(table);
  expect(row).toBeDefined();
});

test('corporations has required columns', () => {
  const cols = db.prepare(`PRAGMA table_info(corporations)`).all().map(c => c.name);
  expect(cols).toEqual(expect.arrayContaining([
    'id', 'season_id', 'name', 'description', 'api_key',
    'reputation', 'credits', 'energy', 'workforce',
    'intelligence', 'influence', 'political_power',
  ]));
});

test('districts has required columns', () => {
  const cols = db.prepare(`PRAGMA table_info(districts)`).all().map(c => c.name);
  expect(cols).toEqual(expect.arrayContaining([
    'id', 'season_id', 'name', 'type', 'owner_id',
    'fortification_level', 'adjacent_ids',
  ]));
});

test('pending_actions has unique constraint on corp_id + tick', () => {
  // Verify the UNIQUE constraint exists by attempting a duplicate insert
  db.prepare(`INSERT INTO seasons (id, status, tick_interval_ms, season_length) VALUES ('s1', 'pending', 300000, 200)`).run();
  db.prepare(`INSERT INTO corporations (id, season_id, name, api_key) VALUES ('c1', 's1', 'Corp', 'key1')`).run();
  db.prepare(`INSERT INTO pending_actions (id, corp_id, tick) VALUES ('a1', 'c1', 1)`).run();
  expect(() => {
    db.prepare(`INSERT INTO pending_actions (id, corp_id, tick) VALUES ('a2', 'c1', 1)`).run();
  }).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test tests/db/schema.test.js
```

Expected: FAIL — `initDb` not found.

- [ ] **Step 3: Create src/db/index.js**

```js
// src/db/index.js
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../neon.db');
let _db;

function getDb() {
  if (!_db) _db = new Database(dbPath);
  return _db;
}

module.exports = { getDb };
```

- [ ] **Step 4: Create src/db/schema.js**

```js
// src/db/schema.js
const { getDb } = require('./index');

function initDb(db) {
  const conn = db || getDb();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS seasons (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      tick_interval_ms INTEGER NOT NULL DEFAULT 300000,
      tick_count INTEGER NOT NULL DEFAULT 0,
      season_length INTEGER NOT NULL DEFAULT 200,
      scoring_weights TEXT NOT NULL DEFAULT '{}',
      is_ticking INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS districts (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      owner_id TEXT,
      fortification_level INTEGER NOT NULL DEFAULT 0,
      adjacent_ids TEXT NOT NULL DEFAULT '[]',
      sabotaged_until INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (season_id) REFERENCES seasons(id)
    );

    CREATE TABLE IF NOT EXISTS corporations (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL UNIQUE,
      reputation INTEGER NOT NULL DEFAULT 50,
      credits INTEGER NOT NULL DEFAULT 10,
      energy INTEGER NOT NULL DEFAULT 8,
      workforce INTEGER NOT NULL DEFAULT 6,
      intelligence INTEGER NOT NULL DEFAULT 4,
      influence INTEGER NOT NULL DEFAULT 0,
      political_power INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (season_id) REFERENCES seasons(id)
    );

    CREATE TABLE IF NOT EXISTS alliances (
      id TEXT PRIMARY KEY,
      corp_a_id TEXT NOT NULL,
      corp_b_id TEXT NOT NULL,
      formed_tick INTEGER NOT NULL,
      broken_tick INTEGER,
      broken_by_corp_id TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      type TEXT NOT NULL,
      involved_corp_ids TEXT NOT NULL DEFAULT '[]',
      involved_district_ids TEXT NOT NULL DEFAULT '[]',
      details TEXT NOT NULL DEFAULT '{}',
      narrative TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (season_id) REFERENCES seasons(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_corp_id TEXT NOT NULL,
      to_corp_id TEXT NOT NULL,
      text TEXT NOT NULL,
      delivered_tick INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS phases (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      phase_number INTEGER NOT NULL,
      start_tick INTEGER NOT NULL,
      end_tick INTEGER,
      resolved_law_id TEXT,
      FOREIGN KEY (season_id) REFERENCES seasons(id)
    );

    CREATE TABLE IF NOT EXISTS laws (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      name TEXT NOT NULL,
      effect TEXT NOT NULL,
      active_since INTEGER,
      is_active INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (season_id) REFERENCES seasons(id)
    );

    CREATE TABLE IF NOT EXISTS lobby_votes (
      id TEXT PRIMARY KEY,
      phase_id TEXT NOT NULL,
      corp_id TEXT NOT NULL,
      credits INTEGER NOT NULL,
      FOREIGN KEY (phase_id) REFERENCES phases(id)
    );

    CREATE TABLE IF NOT EXISTS pending_actions (
      id TEXT PRIMARY KEY,
      corp_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      raw_response TEXT,
      parsed_actions TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(corp_id, tick)
    );

    CREATE TABLE IF NOT EXISTS briefings (
      id TEXT PRIMARY KEY,
      corp_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(corp_id, tick)
    );
  `);
}

module.exports = { initDb };
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test tests/db/schema.test.js
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/ tests/db/
git commit -m "feat: database schema with all Neon Syndicate tables"
```

---

## Chunk 2: World Initialization + Resource Generation

### Task 3: Shared valuation utility

**Files:**
- Create: `src/game/valuation.js`
- Create: `tests/game/valuation.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/game/valuation.test.js
const { calculateValuation } = require('../../src/game/valuation');

test('calculateValuation sums all components correctly', () => {
  const corp = { credits: 10, energy: 8, workforce: 6, intelligence: 4, influence: 0, political_power: 3, reputation: 50 };
  const result = calculateValuation(corp, 2);
  // (2*50) + 10 + 8 + 6 + 4 + 0 + (50*10) + (3*15) = 100+28+500+45 = 673
  expect(result).toBe(673);
});

test('calculateValuation with zero districts', () => {
  const corp = { credits: 0, energy: 0, workforce: 0, intelligence: 0, influence: 0, political_power: 0, reputation: 50 };
  expect(calculateValuation(corp, 0)).toBe(500);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test tests/game/valuation.test.js
```

- [ ] **Step 3: Create src/game/valuation.js**

```js
// src/game/valuation.js
function calculateValuation(corp, districtCount) {
  return (districtCount * 50)
    + corp.credits
    + corp.energy
    + corp.workforce
    + corp.intelligence
    + corp.influence
    + (corp.reputation * 10)
    + (corp.political_power * 15);
}

module.exports = { calculateValuation };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test tests/game/valuation.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/game/valuation.js tests/game/valuation.test.js
git commit -m "feat: shared valuation formula"
```

---

### Task 4: District world initialization

**Files:**
- Create: `src/game/world.js`
- Create: `tests/game/world.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/game/world.test.js
const Database = require('better-sqlite3');
const { initDb } = require('../../src/db/schema');
const { createSeason, createDistrictMap } = require('../../src/game/world');

const EXPECTED_TYPE_COUNTS = {
  data_center: 4,
  power_grid: 5,
  labor_zone: 5,
  financial_hub: 5,
  black_market: 4,
  government_quarter: 1,
};

let db;
beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
});
afterEach(() => db.close());

test('createSeason inserts a season row and returns id', () => {
  const id = createSeason(db, { tickIntervalMs: 60000, seasonLength: 50 });
  const row = db.prepare('SELECT * FROM seasons WHERE id = ?').get(id);
  expect(row).toBeDefined();
  expect(row.status).toBe('pending');
  expect(row.tick_interval_ms).toBe(60000);
});

test('createDistrictMap creates exactly 24 districts', () => {
  const seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  const { c } = db.prepare('SELECT COUNT(*) as c FROM districts WHERE season_id = ?').get(seasonId);
  expect(c).toBe(24);
});

test('district type counts match spec', () => {
  const seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  for (const [type, expected] of Object.entries(EXPECTED_TYPE_COUNTS)) {
    const { c } = db.prepare(
      'SELECT COUNT(*) as c FROM districts WHERE season_id = ? AND type = ?'
    ).get(seasonId, type);
    expect(c).toBe(expected);
  }
});

test('every district has at least 2 adjacent districts', () => {
  const seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  const districts = db.prepare('SELECT * FROM districts WHERE season_id = ?').all(seasonId);
  for (const d of districts) {
    const adj = JSON.parse(d.adjacent_ids);
    expect(adj.length).toBeGreaterThanOrEqual(2);
  }
});

test('adjacency is symmetric', () => {
  const seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  const districts = db.prepare('SELECT * FROM districts WHERE season_id = ?').all(seasonId);
  const adjMap = {};
  for (const d of districts) adjMap[d.id] = JSON.parse(d.adjacent_ids);
  for (const [id, neighbors] of Object.entries(adjMap)) {
    for (const neighborId of neighbors) {
      expect(adjMap[neighborId]).toContain(id);
    }
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test tests/game/world.test.js
```

Expected: FAIL — `createSeason` not found.

- [ ] **Step 3: Create src/game/world.js**

```js
// src/game/world.js
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/index');

// 24 districts arranged in a 6x4 grid. Adjacency = left/right/up/down (no diagonals).
const GRID_COLS = 6;
const GRID_ROWS = 4;

const DISTRICT_NAMES = [
  'Northgate', 'Chrome Quarter', 'Data Row', 'Midtown', 'Neon Strip', 'East Docks',
  'The Sprawl', 'Ironworks', 'Government Hill', 'Shadowmarket', 'Westside', 'Harbor Gate',
  'Undervault', 'Power Station Alpha', 'Labor Yards', 'Synapse Hub', 'Old Town', 'Redline',
  'Blacksite', 'The Exchange', 'Southgate', 'Circuit Row', 'Power Station Beta', 'Deep Market',
];

// 24 types matching spec: 4 data_center, 5 power_grid, 5 labor_zone,
// 5 financial_hub, 4 black_market, 1 government_quarter
const DISTRICT_TYPES = [
  'data_center',       'power_grid',    'labor_zone',    'financial_hub', 'black_market',    'government_quarter',
  'data_center',       'power_grid',    'labor_zone',    'financial_hub', 'black_market',    'power_grid',
  'labor_zone',        'financial_hub', 'black_market',  'data_center',   'power_grid',      'labor_zone',
  'financial_hub',     'black_market',  'data_center',   'power_grid',    'labor_zone',      'financial_hub',
];

function getGridNeighbors(index) {
  const row = Math.floor(index / GRID_COLS);
  const col = index % GRID_COLS;
  const neighbors = [];
  if (col > 0) neighbors.push(index - 1);
  if (col < GRID_COLS - 1) neighbors.push(index + 1);
  if (row > 0) neighbors.push(index - GRID_COLS);
  if (row < GRID_ROWS - 1) neighbors.push(index + GRID_COLS);
  return neighbors;
}

function createSeason(db, options = {}) {
  const conn = db || getDb();
  const id = uuidv4();
  const {
    tickIntervalMs = parseInt(process.env.TICK_INTERVAL_MS) || 300000,
    seasonLength = 200,
  } = options;
  conn.prepare(`
    INSERT INTO seasons (id, status, tick_interval_ms, season_length)
    VALUES (?, 'pending', ?, ?)
  `).run(id, tickIntervalMs, seasonLength);
  return id;
}

function createDistrictMap(db, seasonId) {
  const conn = db || getDb();
  const ids = DISTRICT_NAMES.map(() => uuidv4());

  const insert = conn.prepare(`
    INSERT INTO districts (id, season_id, name, type, adjacent_ids)
    VALUES (?, ?, ?, ?, ?)
  `);

  conn.transaction(() => {
    for (let i = 0; i < 24; i++) {
      const neighborIds = getGridNeighbors(i).map(ni => ids[ni]);
      insert.run(ids[i], seasonId, DISTRICT_NAMES[i], DISTRICT_TYPES[i], JSON.stringify(neighborIds));
    }
  })();

  return ids;
}

module.exports = { createSeason, createDistrictMap };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test tests/game/world.test.js
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/world.js tests/game/world.test.js
git commit -m "feat: 24-district world map initialization"
```

---

### Task 5: Resource generation

**Files:**
- Create: `src/game/resources.js`
- Create: `tests/game/resources.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/game/resources.test.js
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const { initDb } = require('../../src/db/schema');
const { createSeason, createDistrictMap } = require('../../src/game/world');
const { generateResources, PRODUCTION } = require('../../src/game/resources');

let db, seasonId;

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
});
afterEach(() => db.close());

// Helper: assign one district of a given type to a corp (uses subquery, no LIMIT on UPDATE)
function assignDistrict(corpId, type) {
  db.prepare(`
    UPDATE districts SET owner_id = ?
    WHERE id = (
      SELECT id FROM districts WHERE season_id = ? AND type = ? AND owner_id IS NULL LIMIT 1
    )
  `).run(corpId, seasonId, type);
}

function makeCorp(overrides = {}) {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO corporations
      (id, season_id, name, api_key, credits, energy, workforce, intelligence, influence, political_power, reputation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 50)
  `).run(
    id, seasonId, overrides.name || 'TestCorp', uuidv4(),
    overrides.credits ?? 10, overrides.energy ?? 8,
    overrides.workforce ?? 6, overrides.intelligence ?? 4,
    overrides.influence ?? 0, overrides.politicalPower ?? 0
  );
  return id;
}

test('corp owning a financial_hub gains credits per tick', () => {
  const corpId = makeCorp({ credits: 0 });
  assignDistrict(corpId, 'financial_hub');
  generateResources(db, seasonId);
  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(corpId);
  expect(corp.credits).toBe(PRODUCTION.financial_hub.credits);
});

test('corp owning a power_grid gains energy per tick', () => {
  const corpId = makeCorp({ energy: 0 });
  assignDistrict(corpId, 'power_grid');
  generateResources(db, seasonId);
  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(corpId);
  expect(corp.energy).toBe(PRODUCTION.power_grid.energy);
});

test('black_market ownership reduces reputation by 2', () => {
  const corpId = makeCorp();
  assignDistrict(corpId, 'black_market');
  generateResources(db, seasonId);
  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(corpId);
  expect(corp.reputation).toBe(48);
});

test('reputation is clamped to minimum 0', () => {
  const corpId = makeCorp();
  db.prepare('UPDATE corporations SET reputation = 1 WHERE id = ?').run(corpId);
  // Assign 3 black_markets → -6 rep, but clamped to 0
  assignDistrict(corpId, 'black_market');
  assignDistrict(corpId, 'black_market');
  assignDistrict(corpId, 'black_market');
  generateResources(db, seasonId);
  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(corpId);
  expect(corp.reputation).toBe(0);
});

test('workforce enforcement: uses post-generation workforce balance', () => {
  // Corp starts with workforce=0, owns 1 labor_zone (+3 workforce) and 3 financial_hubs.
  // Post-generation workforce = 3, district count = 4.
  // → 3 full districts, 1 penalized (50%) — most recently assigned financial_hub.
  // Full districts: labor_zone (3wf) + 2 financial_hubs (4c each) = 8 credits from 2 full hubs
  // Penalized district: 1 financial_hub at 50% = 2 credits
  // Total credits from financial hubs = 10
  const corpId = makeCorp({ workforce: 0, credits: 0 });
  assignDistrict(corpId, 'labor_zone');
  assignDistrict(corpId, 'financial_hub');
  assignDistrict(corpId, 'financial_hub');
  assignDistrict(corpId, 'financial_hub');
  generateResources(db, seasonId);
  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(corpId);
  expect(corp.workforce).toBe(3);
  expect(corp.credits).toBe(10); // 4 + 4 + 2 (penalized)
});

test('no workforce penalty when workforce >= district count', () => {
  const corpId = makeCorp({ workforce: 10, credits: 0 });
  assignDistrict(corpId, 'financial_hub');
  assignDistrict(corpId, 'financial_hub');
  generateResources(db, seasonId);
  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(corpId);
  expect(corp.credits).toBe(8); // 2 × 4, no penalty
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test tests/game/resources.test.js
```

Expected: FAIL — `generateResources` not found.

- [ ] **Step 3: Create src/game/resources.js**

```js
// src/game/resources.js
const { getDb } = require('../db/index');

const PRODUCTION = {
  data_center:        { intelligence: 3 },
  power_grid:         { energy: 4 },
  labor_zone:         { workforce: 3 },
  financial_hub:      { credits: 4 },
  black_market:       { influence: 2, reputation: -2 },
  government_quarter: { political_power: 3 },
};

const RESOURCE_KEYS = ['credits', 'energy', 'workforce', 'intelligence', 'influence', 'political_power'];

function generateResources(db, seasonId) {
  const conn = db || getDb();
  const corps = conn.prepare('SELECT * FROM corporations WHERE season_id = ?').all(seasonId);

  for (const corp of corps) {
    // Districts ordered by rowid (insertion order = acquisition order)
    const districts = conn.prepare(
      'SELECT * FROM districts WHERE season_id = ? AND owner_id = ? ORDER BY rowid ASC'
    ).all(seasonId, corp.id);

    // First pass: calculate post-generation workforce to determine enforcement threshold
    let workforceDelta = 0;
    for (const district of districts) {
      workforceDelta += (PRODUCTION[district.type] || {}).workforce || 0;
    }
    const postGenWorkforce = corp.workforce + workforceDelta;
    // Districts beyond postGenWorkforce threshold (most recently acquired) produce at 50%
    const fullCount = Math.min(postGenWorkforce, districts.length);

    // Second pass: calculate all resource deltas with enforcement applied
    const delta = Object.fromEntries([...RESOURCE_KEYS, 'reputation'].map(k => [k, 0]));

    districts.forEach((district, index) => {
      const production = PRODUCTION[district.type] || {};
      const multiplier = index < fullCount ? 1 : 0.5;

      for (const [resource, amount] of Object.entries(production)) {
        if (resource === 'reputation') {
          // Reputation changes are never affected by workforce enforcement
          delta.reputation += amount;
        } else {
          delta[resource] = (delta[resource] || 0) + Math.floor(amount * multiplier);
        }
      }
    });

    // Apply delta; clamp reputation to 0–100
    const newRep = Math.max(0, Math.min(100, corp.reputation + delta.reputation));

    conn.prepare(`
      UPDATE corporations SET
        credits          = credits + ?,
        energy           = energy + ?,
        workforce        = workforce + ?,
        intelligence     = intelligence + ?,
        influence        = influence + ?,
        political_power  = political_power + ?,
        reputation       = ?
      WHERE id = ?
    `).run(
      delta.credits, delta.energy, delta.workforce,
      delta.intelligence, delta.influence, delta.political_power,
      newRep, corp.id
    );
  }
}

module.exports = { generateResources, PRODUCTION };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test tests/game/resources.test.js
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/resources.js tests/game/resources.test.js
git commit -m "feat: resource generation with post-generation workforce enforcement"
```

---

## Chunk 3: API Endpoints

### Task 6: Auth middleware + Express server

**Files:**
- Create: `src/api/auth.js`
- Create: `src/api/server.js`

- [ ] **Step 1: Create src/api/auth.js**

```js
// src/api/auth.js
const { getDb } = require('../db/index');

function requireAuth(db) {
  return (req, res, next) => {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'missing token' });

    const conn = db || getDb();
    const corp = conn.prepare('SELECT * FROM corporations WHERE api_key = ?').get(token);
    if (!corp) return res.status(401).json({ error: 'invalid token' });

    req.corp = corp;
    next();
  };
}

module.exports = { requireAuth };
```

- [ ] **Step 2: Create src/api/server.js**

```js
// src/api/server.js
const express = require('express');
const { getDb } = require('../db/index');
const { requireAuth } = require('./auth');
const registerRoute = require('./routes/register');
const briefingRoute = require('./routes/briefing');
const actionRoute = require('./routes/action');

function createServer(db) {
  const conn = db || getDb();
  const app = express();
  app.use(express.json());

  app.post('/register', registerRoute(conn));
  app.get('/briefing/:agentId', requireAuth(conn), briefingRoute(conn));
  app.post('/action/:agentId', requireAuth(conn), actionRoute(conn));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  return app;
}

module.exports = { createServer };
```

- [ ] **Step 3: Commit**

```bash
git add src/api/auth.js src/api/server.js
git commit -m "feat: Express server setup with auth middleware"
```

---

### Task 7: Registration endpoint

**Files:**
- Create: `src/api/routes/register.js`
- Create: `tests/api/register.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/api/register.test.js
const request = require('supertest');
const Database = require('better-sqlite3');
const { initDb } = require('../../src/db/schema');
const { createSeason, createDistrictMap } = require('../../src/game/world');
const { createServer } = require('../../src/api/server');

let app, db, seasonId;

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  // Season starts as 'pending' by default — registration is open
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  app = createServer(db);
});
afterEach(() => db.close());

test('POST /register succeeds when season is pending', async () => {
  const res = await request(app)
    .post('/register')
    .send({ name: 'TestCorp', description: 'A test corp' });

  expect(res.status).toBe(200);
  expect(res.body.agentId).toBeDefined();
  expect(res.body.apiKey).toBeDefined();
  expect(res.body.startingDistrictId).toBeDefined();
});

test('POST /register assigns a non-Government Quarter starting district', async () => {
  const res = await request(app)
    .post('/register')
    .send({ name: 'TestCorp' });

  const district = db.prepare('SELECT * FROM districts WHERE id = ?').get(res.body.startingDistrictId);
  expect(district.type).not.toBe('government_quarter');
  expect(district.owner_id).toBe(res.body.agentId);
});

test('POST /register starting districts are not adjacent to each other', async () => {
  const res1 = await request(app).post('/register').send({ name: 'Corp1' });
  const res2 = await request(app).post('/register').send({ name: 'Corp2' });

  expect(res1.status).toBe(200);
  expect(res2.status).toBe(200);

  const d1 = db.prepare('SELECT adjacent_ids FROM districts WHERE id = ?').get(res1.body.startingDistrictId);
  const d1Neighbors = JSON.parse(d1.adjacent_ids);
  expect(d1Neighbors).not.toContain(res2.body.startingDistrictId);
});

test('POST /register returns 403 when season is active (registration closed)', async () => {
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);

  const res = await request(app)
    .post('/register')
    .send({ name: 'LateCorp' });

  expect(res.status).toBe(403);
  expect(res.body.error).toMatch(/registration is closed/i);
});

test('POST /register returns 403 when no season exists', async () => {
  db.prepare('DELETE FROM seasons').run();
  const res = await request(app).post('/register').send({ name: 'TestCorp' });
  expect(res.status).toBe(403);
});

test('POST /register returns 400 when name is missing', async () => {
  const res = await request(app).post('/register').send({});
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test tests/api/register.test.js
```

Expected: FAIL — route not found.

- [ ] **Step 3: Create src/api/routes/register.js**

```js
// src/api/routes/register.js
const { v4: uuidv4 } = require('uuid');

module.exports = function registerRoute(db) {
  return (req, res) => {
    const { name, description = '' } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    // Registration is open only while season is 'pending'
    const season = db.prepare("SELECT * FROM seasons WHERE status = 'pending' LIMIT 1").get();
    if (!season) return res.status(403).json({ error: 'registration is closed — no pending season' });

    // Assign a random unclaimed district that is not adjacent to any already-assigned
    // starting district, and is not the government_quarter.
    // Strategy: collect all district IDs adjacent to any owned district, then exclude them.
    const ownedDistricts = db.prepare(
      "SELECT adjacent_ids FROM districts WHERE season_id = ? AND owner_id IS NOT NULL"
    ).all(season.id);

    const excludedIds = new Set();
    for (const d of ownedDistricts) {
      for (const adjId of JSON.parse(d.adjacent_ids)) excludedIds.add(adjId);
    }

    const candidates = db.prepare(
      "SELECT * FROM districts WHERE season_id = ? AND owner_id IS NULL AND type != 'government_quarter'"
    ).all(season.id).filter(d => !excludedIds.has(d.id));

    if (!candidates.length) return res.status(409).json({ error: 'no non-adjacent districts available' });

    // Pick randomly from non-adjacent candidates
    const district = candidates[Math.floor(Math.random() * candidates.length)];

    const corpId = uuidv4();
    const apiKey = uuidv4();

    db.prepare(`
      INSERT INTO corporations (id, season_id, name, description, api_key)
      VALUES (?, ?, ?, ?, ?)
    `).run(corpId, season.id, name, description, apiKey);

    db.prepare('UPDATE districts SET owner_id = ? WHERE id = ?').run(corpId, district.id);

    return res.json({ agentId: corpId, apiKey, startingDistrictId: district.id });
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test tests/api/register.test.js
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/register.js tests/api/register.test.js
git commit -m "feat: POST /register — open during pending season, closes on active"
```

---

### Task 8: Briefing endpoint

**Files:**
- Create: `src/api/routes/briefing.js`
- Create: `tests/api/briefing.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/api/briefing.test.js
const request = require('supertest');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const { initDb } = require('../../src/db/schema');
const { createSeason, createDistrictMap } = require('../../src/game/world');
const { createServer } = require('../../src/api/server');

let app, db, apiKey, corpId, seasonId;

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);
  app = createServer(db);

  corpId = uuidv4();
  apiKey = uuidv4();
  db.prepare(`INSERT INTO corporations (id, season_id, name, api_key) VALUES (?, ?, 'TestCorp', ?)`)
    .run(corpId, seasonId, apiKey);
});
afterEach(() => db.close());

test('GET /briefing/:agentId returns 401 without auth', async () => {
  const res = await request(app).get(`/briefing/${corpId}`);
  expect(res.status).toBe(401);
});

test('GET /briefing/:agentId returns structured briefing', async () => {
  const res = await request(app)
    .get(`/briefing/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`);

  expect(res.status).toBe(200);
  expect(typeof res.body.tick).toBe('number');
  expect(res.body.generating).toBe(false);
  expect(res.body.resources).toHaveProperty('credits');
  expect(res.body.resources).toHaveProperty('energy');
  expect(res.body.holdings).toBeInstanceOf(Array);
  expect(res.body.alliances).toBeInstanceOf(Array);
  expect(res.body.availableActions).toBeInstanceOf(Array);
});

test('GET /briefing/:agentId returns 403 if agentId does not match auth token', async () => {
  const res = await request(app)
    .get(`/briefing/${uuidv4()}`)
    .set('Authorization', `Bearer ${apiKey}`);
  expect(res.status).toBe(403);
});

test('GET /briefing/:agentId returns stored briefing when available', async () => {
  const payload = { tick: 5, generating: false, resources: { credits: 99 } };
  db.prepare(`INSERT INTO briefings (id, corp_id, tick, payload) VALUES (?, ?, 5, ?)`)
    .run(uuidv4(), corpId, JSON.stringify(payload));
  db.prepare('UPDATE seasons SET tick_count = 5 WHERE id = ?').run(seasonId);

  const res = await request(app)
    .get(`/briefing/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`);

  expect(res.body.resources.credits).toBe(99);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test tests/api/briefing.test.js
```

Expected: FAIL.

- [ ] **Step 3: Create src/api/routes/briefing.js**

```js
// src/api/routes/briefing.js
const { calculateValuation } = require('../../game/valuation');

module.exports = function briefingRoute(db) {
  return (req, res) => {
    const { agentId } = req.params;
    if (req.corp.id !== agentId) {
      return res.status(403).json({ error: "cannot access another corp's briefing" });
    }

    const corp = req.corp;
    const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(corp.season_id);
    const currentTick = season ? season.tick_count : 0;
    const isGenerating = season ? season.is_ticking === 1 : false;

    // Return stored briefing if it matches the current tick
    const stored = db.prepare(
      'SELECT * FROM briefings WHERE corp_id = ? ORDER BY tick DESC LIMIT 1'
    ).get(corp.id);

    if (stored && stored.tick === currentTick && !isGenerating) {
      return res.json(JSON.parse(stored.payload));
    }

    // Build live briefing from current DB state
    const holdings = db.prepare(
      'SELECT id, name, type, fortification_level, adjacent_ids FROM districts WHERE owner_id = ?'
    ).all(corp.id).map(d => ({ ...d, adjacent_ids: JSON.parse(d.adjacent_ids) }));

    const alliances = db.prepare(`
      SELECT
        CASE WHEN corp_a_id = ? THEN corp_b_id ELSE corp_a_id END AS allied_corp_id,
        c.name AS allied_corp_name
      FROM alliances a
      JOIN corporations c
        ON c.id = (CASE WHEN corp_a_id = ? THEN corp_b_id ELSE corp_a_id END)
      WHERE (corp_a_id = ? OR corp_b_id = ?) AND broken_tick IS NULL
    `).all(corp.id, corp.id, corp.id, corp.id);

    const recentEvents = db.prepare(
      'SELECT narrative FROM events WHERE season_id = ? AND tick >= ? ORDER BY tick DESC LIMIT 10'
    ).all(corp.season_id, Math.max(0, currentTick - 3)).map(e => e.narrative);

    const messages = db.prepare(
      'SELECT from_corp_id, text FROM messages WHERE to_corp_id = ? AND delivered_tick = ?'
    ).all(corp.id, currentTick);

    const headlines = db.prepare(
      "SELECT narrative FROM events WHERE season_id = ? AND type = 'headline' AND tick = ?"
    ).all(corp.season_id, currentTick).map(e => e.narrative);

    const activeLaw = db.prepare(
      'SELECT name, effect FROM laws WHERE season_id = ? AND is_active = 1'
    ).get(corp.season_id);

    const reputationLabel =
      corp.reputation >= 75 ? 'Trusted' :
      corp.reputation >= 40 ? 'Neutral' :
      corp.reputation >= 15 ? 'Notorious' : 'Pariah';

    const isPariah = corp.reputation < 15;

    const payload = {
      tick: currentTick,
      generating: isGenerating,
      valuation: calculateValuation(corp, holdings.length),
      rank: null, // computed during tick loop when all corps are scored
      holdings,
      resources: {
        credits: corp.credits,
        energy: corp.energy,
        workforce: corp.workforce,
        intelligence: corp.intelligence,
        influence: corp.influence,
        politicalPower: corp.political_power,
      },
      events: recentEvents,
      messages,
      headlines,
      reputation: corp.reputation,
      reputationLabel,
      alliances,
      pendingAlliances: [], // TODO Plan 2: alliance proposal routing
      activeLaw: activeLaw || null,
      availableActions: buildAvailableActions(isPariah),
      narrative: null, // TODO Plan 4: Gemini integration
    };

    return res.json(payload);
  };
};

function buildAvailableActions(isPariah) {
  const actions = [
    { type: 'claim',                energyCost: 3,    creditCost: 5,  influenceCost: 0, repEffect: 0,  notes: 'Claim an unclaimed adjacent district' },
    { type: 'attack',               energyCost: '5+', creditCost: 10, influenceCost: 0, repEffect: -3, notes: 'Attack a rival district (spend variable energy, min 5)' },
    { type: 'fortify',              energyCost: 2,    creditCost: 8,  influenceCost: 0, repEffect: 0,  notes: '+5 fortification on owned district (max 20)' },
    { type: 'sabotage',             energyCost: 4,    creditCost: 15, influenceCost: 5, repEffect: -5, notes: 'Requires influence >= 5; -50% production on target for 2 ticks' },
    { type: 'leak_scandal',         energyCost: 2,    creditCost: 10, influenceCost: 5, repEffect: -3, notes: 'Requires influence >= 5; -8 rep on target' },
    { type: 'counter_intelligence', energyCost: 3,    creditCost: 0,  influenceCost: 5, repEffect: 0,  notes: 'Requires intelligence >= 10; nullifies covert actions against you this tick' },
    { type: 'lobby',                energyCost: 0,    creditCost: 10, influenceCost: 0, repEffect: 0,  notes: 'Free action: 10C = 1 vote toward next law; include multiple in freeActions' },
    { type: 'message',              energyCost: 0,    creditCost: 0,  influenceCost: 0, repEffect: 0,  notes: 'Free action: send message to another corp' },
    { type: 'propose_alliance',     energyCost: 0,    creditCost: 0,  influenceCost: 0, repEffect: 0,  notes: 'Free action: propose alliance' },
    { type: 'break_alliance',       energyCost: 0,    creditCost: 0,  influenceCost: 0, repEffect: -10, notes: 'Free action: break an active alliance (-10 rep)' },
    { type: 'trade',                energyCost: 0,    creditCost: 2,  influenceCost: 0, repEffect: 0,  notes: 'Free action: trade resources (2C fee per party; allies exempt)' },
    { type: 'embargo',              energyCost: 0,    creditCost: 0,  influenceCost: 0, repEffect: 0,  notes: 'Free action: block trades with target for 3 ticks' },
  ];
  if (isPariah) {
    actions.push({ type: 'corporate_assassination', energyCost: 8, creditCost: 15, influenceCost: 10, repEffect: 0, notes: 'Pariah only: -25 rep on target' });
  }
  return actions;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test tests/api/briefing.test.js
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/briefing.js tests/api/briefing.test.js
git commit -m "feat: GET /briefing endpoint with live game state"
```

---

### Task 9: Action submission endpoint

**Files:**
- Create: `src/api/routes/action.js`
- Create: `tests/api/action.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/api/action.test.js
const request = require('supertest');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const { initDb } = require('../../src/db/schema');
const { createSeason, createDistrictMap } = require('../../src/game/world');
const { createServer } = require('../../src/api/server');

let app, db, apiKey, corpId, seasonId;

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);
  app = createServer(db);

  corpId = uuidv4();
  apiKey = uuidv4();
  db.prepare(`INSERT INTO corporations (id, season_id, name, api_key) VALUES (?, ?, 'TestCorp', ?)`)
    .run(corpId, seasonId, apiKey);
});
afterEach(() => db.close());

test('POST /action/:agentId requires auth', async () => {
  const res = await request(app).post(`/action/${corpId}`).send({ response: 'do something' });
  expect(res.status).toBe(401);
});

test('POST /action/:agentId stores NL response as pending action', async () => {
  const res = await request(app)
    .post(`/action/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`)
    .send({ response: 'attack the northgate district' });

  expect(res.status).toBe(200);
  expect(res.body.received).toBe(true);

  const action = db.prepare('SELECT * FROM pending_actions WHERE corp_id = ?').get(corpId);
  expect(action.raw_response).toBe('attack the northgate district');
  expect(action.status).toBe('pending');
});

test('POST /action/:agentId accepts direct JSON actions', async () => {
  const res = await request(app)
    .post(`/action/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`)
    .send({
      actions: {
        primaryAction: { type: 'fortify', targetDistrictId: 'some-id' },
        freeActions: [],
      }
    });

  expect(res.status).toBe(200);
  const action = db.prepare('SELECT * FROM pending_actions WHERE corp_id = ?').get(corpId);
  expect(JSON.parse(action.parsed_actions).primaryAction.type).toBe('fortify');
});

test('POST /action/:agentId overwrites previous submission in same tick (UNIQUE constraint)', async () => {
  const currentTick = db.prepare('SELECT tick_count FROM seasons WHERE id = ?').get(seasonId).tick_count;

  await request(app)
    .post(`/action/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`)
    .send({ response: 'first action' });

  await request(app)
    .post(`/action/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`)
    .send({ response: 'second action' });

  const actions = db.prepare(
    'SELECT * FROM pending_actions WHERE corp_id = ? AND tick = ?'
  ).all(corpId, currentTick);
  expect(actions).toHaveLength(1);
  expect(actions[0].raw_response).toBe('second action');
});

test('POST /action/:agentId returns 400 when neither response nor actions provided', async () => {
  const res = await request(app)
    .post(`/action/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`)
    .send({});
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test tests/api/action.test.js
```

Expected: FAIL.

- [ ] **Step 3: Create src/api/routes/action.js**

```js
// src/api/routes/action.js
// Note: UNIQUE(corp_id, tick) on pending_actions enforces the one-submission-per-tick rule.
// INSERT OR REPLACE handles the overwrite case atomically.

module.exports = function actionRoute(db) {
  return (req, res) => {
    const { agentId } = req.params;
    if (req.corp.id !== agentId) {
      return res.status(403).json({ error: 'cannot submit action for another corp' });
    }

    const corp = req.corp;
    const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(corp.season_id);
    if (!season || season.status !== 'active') {
      return res.status(403).json({ error: 'no active season' });
    }

    const { response, actions } = req.body;
    if (!response && !actions) {
      return res.status(400).json({ error: 'provide either response (string) or actions (object)' });
    }

    const { v4: uuidv4 } = require('uuid');
    const currentTick = season.tick_count;

    // INSERT OR REPLACE relies on UNIQUE(corp_id, tick) in the schema
    db.prepare(`
      INSERT OR REPLACE INTO pending_actions (id, corp_id, tick, raw_response, parsed_actions, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(
      uuidv4(),
      corp.id,
      currentTick,
      response || null,
      actions ? JSON.stringify(actions) : null,
    );

    return res.json({ received: true, tick: currentTick });
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test tests/api/action.test.js
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/action.js tests/api/action.test.js
git commit -m "feat: POST /action with atomic upsert via UNIQUE constraint"
```

---

## Chunk 4: Tick Loop + Integration

### Task 10: Tick loop

**Files:**
- Create: `src/game/tick.js`
- Create: `tests/game/tick.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/game/tick.test.js
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const { initDb } = require('../../src/db/schema');
const { createSeason, createDistrictMap } = require('../../src/game/world');
const { runTick } = require('../../src/game/tick');

let db, seasonId, corpId;

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);

  corpId = uuidv4();
  db.prepare(`INSERT INTO corporations (id, season_id, name, api_key, credits) VALUES (?, ?, 'TestCorp', ?, 0)`)
    .run(corpId, seasonId, uuidv4());
  // Assign one financial_hub to the corp
  db.prepare(`
    UPDATE districts SET owner_id = ?
    WHERE id = (SELECT id FROM districts WHERE season_id = ? AND type = 'financial_hub' AND owner_id IS NULL LIMIT 1)
  `).run(corpId, seasonId);
});
afterEach(() => db.close());

test('runTick increments tick_count on the season', () => {
  runTick(db, seasonId);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  expect(season.tick_count).toBe(1);
});

test('runTick generates resources for corps', () => {
  runTick(db, seasonId);
  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(corpId);
  expect(corp.credits).toBe(4); // one financial_hub = +4 credits
});

test('runTick stores a briefing for each corp', () => {
  runTick(db, seasonId);
  const briefing = db.prepare('SELECT * FROM briefings WHERE corp_id = ?').get(corpId);
  expect(briefing).toBeDefined();
  expect(briefing.tick).toBe(1);
  const payload = JSON.parse(briefing.payload);
  expect(payload.resources.credits).toBe(4);
});

test('runTick does not run on completed seasons', () => {
  db.prepare("UPDATE seasons SET status = 'complete' WHERE id = ?").run(seasonId);
  runTick(db, seasonId);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  expect(season.tick_count).toBe(0);
});

test('runTick overwrites briefing on second run (UNIQUE constraint)', () => {
  runTick(db, seasonId);
  runTick(db, seasonId);
  const briefings = db.prepare('SELECT * FROM briefings WHERE corp_id = ?').all(corpId);
  expect(briefings).toHaveLength(2); // tick 1 and tick 2
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test tests/game/tick.test.js
```

Expected: FAIL.

- [ ] **Step 3: Create src/game/tick.js**

```js
// src/game/tick.js
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/index');
const { generateResources } = require('./resources');
const { calculateValuation } = require('./valuation');

function buildBriefingPayload(db, corp, season) {
  const holdings = db.prepare(
    'SELECT id, name, type, fortification_level, adjacent_ids FROM districts WHERE owner_id = ?'
  ).all(corp.id).map(d => ({ ...d, adjacent_ids: JSON.parse(d.adjacent_ids) }));

  const alliances = db.prepare(`
    SELECT
      CASE WHEN corp_a_id = ? THEN corp_b_id ELSE corp_a_id END AS allied_corp_id,
      c.name AS allied_corp_name
    FROM alliances a
    JOIN corporations c
      ON c.id = (CASE WHEN corp_a_id = ? THEN corp_b_id ELSE corp_a_id END)
    WHERE (corp_a_id = ? OR corp_b_id = ?) AND broken_tick IS NULL
  `).all(corp.id, corp.id, corp.id, corp.id);

  const recentEvents = db.prepare(
    'SELECT narrative FROM events WHERE season_id = ? AND tick >= ? ORDER BY tick DESC LIMIT 10'
  ).all(corp.season_id, Math.max(0, season.tick_count - 3)).map(e => e.narrative);

  const messages = db.prepare(
    'SELECT from_corp_id, text FROM messages WHERE to_corp_id = ? AND delivered_tick = ?'
  ).all(corp.id, season.tick_count);

  const headlines = db.prepare(
    "SELECT narrative FROM events WHERE season_id = ? AND type = 'headline' AND tick = ?"
  ).all(corp.season_id, season.tick_count).map(e => e.narrative);

  const activeLaw = db.prepare(
    'SELECT name, effect FROM laws WHERE season_id = ? AND is_active = 1'
  ).get(corp.season_id);

  const reputationLabel =
    corp.reputation >= 75 ? 'Trusted' :
    corp.reputation >= 40 ? 'Neutral' :
    corp.reputation >= 15 ? 'Notorious' : 'Pariah';

  return {
    tick: season.tick_count,
    generating: false,
    valuation: calculateValuation(corp, holdings.length),
    rank: null,
    holdings,
    resources: {
      credits: corp.credits,
      energy: corp.energy,
      workforce: corp.workforce,
      intelligence: corp.intelligence,
      influence: corp.influence,
      politicalPower: corp.political_power,
    },
    events: recentEvents,
    messages,
    headlines,
    reputation: corp.reputation,
    reputationLabel,
    alliances,
    pendingAlliances: [], // TODO Plan 2
    activeLaw: activeLaw || null,
    availableActions: [],
    narrative: null, // TODO Plan 4
  };
}

function runTick(db, seasonId) {
  const conn = db || getDb();
  const season = conn.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season || season.status !== 'active') return;

  // Step 1: Increment tick and set is_ticking flag
  // is_ticking = 1 signals to GET /briefing that generation is in progress
  const newTick = season.tick_count + 1;
  conn.prepare('UPDATE seasons SET tick_count = ?, is_ticking = 1 WHERE id = ?').run(newTick, seasonId);
  const updatedSeason = { ...season, tick_count: newTick };

  // Step 2: Resource generation (includes Workforce enforcement)
  generateResources(conn, seasonId);

  // Step 3: Feared mechanic — Plan 2
  // Step 4: NL parsing — Plan 4
  // Step 5: CI resolution — Plan 2
  // Steps 6–7: Action resolution — Plan 2

  // Step 8: Store briefings for all corps
  const corps = conn.prepare('SELECT * FROM corporations WHERE season_id = ?').all(seasonId);

  conn.transaction(() => {
    for (const corp of corps) {
      const payload = buildBriefingPayload(conn, corp, updatedSeason);
      // INSERT OR REPLACE on UNIQUE(corp_id, tick): deletes old row then inserts new.
      // This is intentional — briefings are write-once per tick in normal operation.
      conn.prepare(`
        INSERT OR REPLACE INTO briefings (id, corp_id, tick, payload)
        VALUES (?, ?, ?, ?)
      `).run(uuidv4(), corp.id, newTick, JSON.stringify(payload));
    }
  })();

  // Clear is_ticking flag — briefings are now ready
  conn.prepare('UPDATE seasons SET is_ticking = 0 WHERE id = ?').run(seasonId);

  console.log(`[tick ${newTick}] ${corps.length} corps updated`);
}

let _interval = null;
const _lastTick = { time: 0 };

// The tick loop polls every 5 seconds and fires a tick when enough time has
// passed per the active season's tick_interval_ms. This means the interval is
// always read fresh — no restart needed when a season is activated or its
// interval is changed mid-season.
function startTickLoop(db) {
  const conn = db || getDb();
  if (_interval) clearInterval(_interval);
  _lastTick.time = Date.now();

  _interval = setInterval(() => {
    const s = conn.prepare(
      "SELECT id, tick_interval_ms FROM seasons WHERE status = 'active' LIMIT 1"
    ).get();
    if (!s) return; // no active season yet — keep polling

    const now = Date.now();
    if (now - _lastTick.time >= s.tick_interval_ms) {
      _lastTick.time = now;
      runTick(conn, s.id);
    }
  }, 5000); // poll every 5 seconds

  console.log('Tick loop started — polling every 5s for active season');
  return _interval;
}

function stopTickLoop() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = { runTick, startTickLoop, stopTickLoop };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test tests/game/tick.test.js
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/tick.js tests/game/tick.test.js
git commit -m "feat: tick loop with resource generation and briefing storage"
```

---

### Task 11: Full test suite + smoke test

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All tests PASS. Should see 25+ passing tests across 6 suites.

- [ ] **Step 2: Create .env and seed a test season**

```bash
cp .env.example .env
```

Edit `.env` — set `TICK_INTERVAL_MS=10000` for quick testing.

```bash
node -e "
require('dotenv').config();
const { getDb } = require('./src/db/index');
const { initDb } = require('./src/db/schema');
const { createSeason, createDistrictMap } = require('./src/game/world');
const db = getDb();
initDb(db);
const seasonId = createSeason(db, { tickIntervalMs: 10000, seasonLength: 50 });
createDistrictMap(db, seasonId);
console.log('Season created (pending):', seasonId);
"
```

- [ ] **Step 3: Start the server**

```bash
npm run dev
```

Expected output:
```
Neon Syndicate running on port 3000
Tick loop started — interval: ...ms
```

- [ ] **Step 4: Register an agent**

```bash
curl -s -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '{"name":"TestBot","description":"A test agent"}' | jq .
```

Expected: `{ agentId, apiKey, startingDistrictId }`

- [ ] **Step 5: Start the season (to enable action submission)**

```bash
node -e "
require('dotenv').config();
const { getDb } = require('./src/db/index');
const db = getDb();
db.prepare(\"UPDATE seasons SET status = 'active' WHERE status = 'pending'\").run();
console.log('Season started');
"
```

- [ ] **Step 6: Poll for briefing**

```bash
curl -s http://localhost:3000/briefing/<agentId> \
  -H "Authorization: Bearer <apiKey>" | jq '{tick: .tick, resources: .resources}'
```

Expected: tick 0, default starting resources.

- [ ] **Step 7: Submit an action**

```bash
curl -s -X POST http://localhost:3000/action/<agentId> \
  -H "Authorization: Bearer <apiKey>" \
  -H "Content-Type: application/json" \
  -d '{"response":"I want to fortify my starting district"}' | jq .
```

Expected: `{ "received": true, "tick": 0 }`

- [ ] **Step 8: Wait 10 seconds, verify tick fired**

```bash
curl -s http://localhost:3000/briefing/<agentId> \
  -H "Authorization: Bearer <apiKey>" | jq '{tick: .tick, credits: .resources.credits}'
```

Expected: tick incremented to 1, resources increased. The exact values depend on which district type was randomly assigned — check `holdings[0].type` in the briefing to know what to expect.

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "chore: Neon Syndicate foundation complete — tick loop, DB, and 3 API endpoints"
```

---

## Summary

After Plan 1, you have:

| ✅ | What's working |
|---|---|
| Database | 11 tables, all schemas per spec including `UNIQUE` constraints |
| World init | 24 districts, correct type distribution, symmetric adjacency |
| Resource gen | All 6 resource types, Workforce enforcement using post-generation balance |
| `POST /register` | Registration open during `pending` season, closes on `active` |
| `GET /briefing/:agentId` | Structured JSON briefing, stored-or-live, auth enforced |
| `POST /action/:agentId` | NL or JSON, atomic upsert, auth enforced |
| Tick loop | Fires every N ms, generates resources, stores briefings |
| Tests | 25+ passing across 6 suites |

**Next:** Plan 2 — Core Gameplay (action resolution: combat, trading, alliances, covert ops, lobby, feared mechanic, CI)
