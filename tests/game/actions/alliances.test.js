const Database = require('better-sqlite3');
const { initDb } = require('../../../src/db/schema');
const { createSeason } = require('../../../src/game/world');
const { resolveAlliances } = require('../../../src/game/actions/alliances');

let db, seasonId;

function makeCorp(id, name, reputation = 50) {
  db.prepare(
    'INSERT INTO corporations (id, season_id, name, api_key, reputation) VALUES (?, ?, ?, ?, ?)'
  ).run(id, seasonId, name, `key-${id}`, reputation);
}

function activeAlliances(corpId) {
  return db.prepare(`
    SELECT * FROM alliances
    WHERE (corp_a_id = ? OR corp_b_id = ?) AND formed_tick IS NOT NULL AND broken_tick IS NULL
  `).all(corpId, corpId);
}

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
});
afterEach(() => db.close());

test('propose_alliance creates a pending alliance', () => {
  makeCorp('c1', 'Corp1');
  makeCorp('c2', 'Corp2');
  resolveAlliances(db, seasonId, 1, [
    { corpId: 'c1', action: { type: 'propose_alliance', targetCorpId: 'c2' } }
  ]);
  const pending = db.prepare(
    'SELECT * FROM alliances WHERE corp_a_id = ? AND corp_b_id = ? AND formed_tick IS NULL'
  ).get('c1', 'c2');
  expect(pending).toBeDefined();
  expect(pending.proposed_tick).toBe(1);
});

test('accept_alliance forms the alliance', () => {
  makeCorp('c1', 'Corp1');
  makeCorp('c2', 'Corp2');
  // Proposal exists from previous tick
  db.prepare('INSERT INTO alliances (id, corp_a_id, corp_b_id, proposed_tick) VALUES (?, ?, ?, ?)')
    .run('a1', 'c1', 'c2', 1);

  resolveAlliances(db, seasonId, 2, [
    { corpId: 'c2', action: { type: 'accept_alliance', allianceId: 'a1' } }
  ]);

  const alliance = db.prepare('SELECT * FROM alliances WHERE id = ?').get('a1');
  expect(alliance.formed_tick).toBe(2);
});

test('break_alliance costs -10 reputation', () => {
  makeCorp('c1', 'Corp1', 50);
  makeCorp('c2', 'Corp2');
  db.prepare('INSERT INTO alliances (id, corp_a_id, corp_b_id, proposed_tick, formed_tick) VALUES (?, ?, ?, ?, ?)')
    .run('a1', 'c1', 'c2', 1, 1);

  resolveAlliances(db, seasonId, 3, [
    { corpId: 'c1', action: { type: 'break_alliance', allianceId: 'a1' } }
  ]);

  const alliance = db.prepare('SELECT * FROM alliances WHERE id = ?').get('a1');
  expect(alliance.broken_tick).toBe(3);
  expect(alliance.broken_by_corp_id).toBe('c1');
  const corp = db.prepare('SELECT reputation FROM corporations WHERE id = ?').get('c1');
  expect(corp.reputation).toBe(40); // 50 - 10
});
