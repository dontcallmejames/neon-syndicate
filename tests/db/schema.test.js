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

test('alliances table accepts proposed_tick and nullable formed_tick', () => {
  const db = new Database(':memory:');
  initDb(db);
  db.prepare(
    "INSERT INTO alliances (id, corp_a_id, corp_b_id, proposed_tick) VALUES ('a1','c1','c2',1)"
  ).run();
  const row = db.prepare("SELECT * FROM alliances WHERE id = 'a1'").get();
  expect(row.proposed_tick).toBe(1);
  expect(row.formed_tick).toBeNull();
  db.close();
});

test('embargoes table exists with required columns', () => {
  const db = new Database(':memory:');
  initDb(db);
  db.prepare(
    "INSERT INTO embargoes (id, corp_id, target_corp_id, expires_tick) VALUES ('e1','c1','c2',5)"
  ).run();
  const row = db.prepare("SELECT * FROM embargoes WHERE id = 'e1'").get();
  expect(row.expires_tick).toBe(5);
  db.close();
});

test('lobby_votes has law_id column', () => {
  const db = new Database(':memory:');
  initDb(db);
  // Need a season and phase to satisfy the phase_id FK
  db.prepare("INSERT INTO seasons (id, tick_interval_ms, season_length) VALUES ('s1', 300000, 200)").run();
  db.prepare("INSERT INTO phases (id, season_id, phase_number, start_tick) VALUES ('p1', 's1', 1, 1)").run();
  db.prepare(
    "INSERT INTO lobby_votes (id, phase_id, corp_id, law_id, credits) VALUES ('v1','p1','c1','l1',10)"
  ).run();
  const row = db.prepare("SELECT * FROM lobby_votes WHERE id = 'v1'").get();
  expect(row.law_id).toBe('l1');
  db.close();
});
