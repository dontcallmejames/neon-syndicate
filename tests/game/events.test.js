const Database = require('better-sqlite3');
const { initDb } = require('../../src/db/schema');
const { createSeason } = require('../../src/game/world');
const { writeEvent } = require('../../src/game/events');

let db, seasonId;
beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
});
afterEach(() => db.close());

test('writeEvent inserts a row into events', () => {
  writeEvent(db, { seasonId, tick: 1, type: 'test', narrative: 'hello' });
  const rows = db.prepare('SELECT * FROM events WHERE season_id = ?').all(seasonId);
  expect(rows).toHaveLength(1);
  expect(rows[0].narrative).toBe('hello');
  expect(rows[0].type).toBe('test');
});

test('writeEvent stores involvedCorpIds as JSON array', () => {
  writeEvent(db, { seasonId, tick: 1, type: 'combat', involvedCorpIds: ['c1', 'c2'] });
  const row = db.prepare('SELECT * FROM events').get();
  expect(JSON.parse(row.involved_corp_ids)).toEqual(['c1', 'c2']);
});

test('writeEvent defaults to empty arrays and object', () => {
  writeEvent(db, { seasonId, tick: 2, type: 'test' });
  const row = db.prepare('SELECT * FROM events').get();
  expect(JSON.parse(row.involved_corp_ids)).toEqual([]);
  expect(JSON.parse(row.involved_district_ids)).toEqual([]);
  expect(JSON.parse(row.details)).toEqual({});
});
