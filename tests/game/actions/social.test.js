const Database = require('better-sqlite3');
const { initDb } = require('../../../src/db/schema');
const { createSeason } = require('../../../src/game/world');
const { resolveSocial } = require('../../../src/game/actions/social');

let db, seasonId;

function makeCorp(id, name, credits = 100) {
  db.prepare('INSERT INTO corporations (id, season_id, name, api_key, credits) VALUES (?, ?, ?, ?, ?)')
    .run(id, seasonId, name, `key-${id}`, credits);
}

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
});
afterEach(() => db.close());

test('message is stored for delivery at current tick', () => {
  makeCorp('c1', 'Sender');
  makeCorp('c2', 'Recipient');

  resolveSocial(db, seasonId, 5, [
    { corpId: 'c1', action: { type: 'message', toCorpId: 'c2', text: 'Stand down.' } }
  ]);

  const msg = db.prepare('SELECT * FROM messages WHERE from_corp_id = ?').get('c1');
  expect(msg).toBeDefined();
  expect(msg.text).toBe('Stand down.');
  expect(msg.to_corp_id).toBe('c2');
  expect(msg.delivered_tick).toBe(5);
});

test('lobby vote stored with law_id and credits', () => {
  makeCorp('c1', 'Lobbyist', 100);
  const phaseId = 'phase-1';
  db.prepare('INSERT INTO phases (id, season_id, phase_number, start_tick) VALUES (?, ?, 1, 1)').run(phaseId, seasonId);
  const lawId = db.prepare("SELECT id FROM laws WHERE season_id = ? LIMIT 1").get(seasonId).id;

  resolveSocial(db, seasonId, 3, [
    { corpId: 'c1', action: { type: 'lobby', lawId, credits: 20 } }
  ], phaseId);

  const vote = db.prepare('SELECT * FROM lobby_votes WHERE corp_id = ?').get('c1');
  expect(vote).toBeDefined();
  expect(vote.law_id).toBe(lawId);
  expect(vote.credits).toBe(20);

  // Credits deducted
  const corp = db.prepare('SELECT credits FROM corporations WHERE id = ?').get('c1');
  expect(corp.credits).toBe(80); // 100 - 20
});

test('embargo stored with correct expiry', () => {
  makeCorp('c1', 'Embargoer');
  makeCorp('c2', 'Target');

  resolveSocial(db, seasonId, 4, [
    { corpId: 'c1', action: { type: 'embargo', targetCorpId: 'c2' } }
  ]);

  const embargo = db.prepare(
    'SELECT * FROM embargoes WHERE corp_id = ? AND target_corp_id = ?'
  ).get('c1', 'c2');
  expect(embargo).toBeDefined();
  expect(embargo.expires_tick).toBe(7); // tick 4 + 3
});
