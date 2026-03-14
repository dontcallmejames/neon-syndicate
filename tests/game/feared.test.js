const Database = require('better-sqlite3');
const { initDb } = require('../../src/db/schema');
const { createSeason } = require('../../src/game/world');
const { applyFeared } = require('../../src/game/feared');

let db, seasonId;

function makeCorp(id, name, credits, reputation) {
  db.prepare(
    'INSERT INTO corporations (id, season_id, name, api_key, credits, reputation) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, seasonId, name, `key-${id}`, credits, reputation);
}

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);
});
afterEach(() => db.close());

test('pariah collects 5 credits from non-pariah', () => {
  makeCorp('p1', 'Pariah', 0, 10);
  makeCorp('n1', 'Neutral', 20, 50);
  applyFeared(db, seasonId, 1);
  expect(db.prepare('SELECT credits FROM corporations WHERE id = ?').get('p1').credits).toBe(5);
  expect(db.prepare('SELECT credits FROM corporations WHERE id = ?').get('n1').credits).toBe(15);
  expect(db.prepare("SELECT COUNT(*) AS cnt FROM events WHERE type = 'feared'").get().cnt).toBe(1);
});

test('payer with only 3 credits pays 3, not 5', () => {
  makeCorp('p1', 'Pariah', 0, 10);
  makeCorp('n1', 'Broke', 3, 50);
  applyFeared(db, seasonId, 1);
  expect(db.prepare('SELECT credits FROM corporations WHERE id = ?').get('p1').credits).toBe(3);
  expect(db.prepare('SELECT credits FROM corporations WHERE id = ?').get('n1').credits).toBe(0);
});

test('payer pays first pariah then has nothing for second (ordered by id ASC)', () => {
  makeCorp('aaa-p', 'Alpha', 0, 10);
  makeCorp('bbb-p', 'Beta',  0, 5);
  makeCorp('ccc-n', 'Payer', 3, 50);
  applyFeared(db, seasonId, 1);
  expect(db.prepare("SELECT credits FROM corporations WHERE id = 'aaa-p'").get().credits).toBe(3);
  expect(db.prepare("SELECT credits FROM corporations WHERE id = 'bbb-p'").get().credits).toBe(0);
  expect(db.prepare("SELECT credits FROM corporations WHERE id = 'ccc-n'").get().credits).toBe(0);
});

test('pariah corps do not pay each other', () => {
  makeCorp('p1', 'P1', 100, 10);
  makeCorp('p2', 'P2', 100, 5);
  applyFeared(db, seasonId, 1);
  expect(db.prepare('SELECT credits FROM corporations WHERE id = ?').get('p1').credits).toBe(100);
  expect(db.prepare('SELECT credits FROM corporations WHERE id = ?').get('p2').credits).toBe(100);
});

test('no pariah means no transfers', () => {
  makeCorp('c1', 'Corp', 100, 50);
  applyFeared(db, seasonId, 1);
  expect(db.prepare('SELECT credits FROM corporations WHERE id = ?').get('c1').credits).toBe(100);
});
