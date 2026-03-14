// tests/game/resources.test.js
const Database = require('better-sqlite3');
const crypto = require('crypto');
const { initDb } = require('../../src/db/schema');
const { createSeason, createDistrictMap } = require('../../src/game/world');
const { generateResources, PRODUCTION } = require('../../src/game/resources');

// Simple UUID v4 implementation for CommonJS compatibility
function uuidv4() {
  return crypto.randomUUID();
}

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
