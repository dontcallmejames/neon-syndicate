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
