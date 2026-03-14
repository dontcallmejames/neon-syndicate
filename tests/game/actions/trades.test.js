const Database = require('better-sqlite3');
const { initDb } = require('../../../src/db/schema');
const { createSeason } = require('../../../src/game/world');
const { resolveTrades } = require('../../../src/game/actions/trades');

let db, seasonId;

function makeCorp(id, name, overrides = {}) {
  db.prepare(`
    INSERT INTO corporations (id, season_id, name, api_key, credits, energy)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, seasonId, name, `key-${id}`, overrides.credits ?? 50, overrides.energy ?? 50);
}

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
});
afterEach(() => db.close());

test('matched trade transfers resources and charges fee', () => {
  makeCorp('c1', 'Corp1', { credits: 50, energy: 10 });
  makeCorp('c2', 'Corp2', { credits: 10, energy: 50 });

  resolveTrades(db, seasonId, 1, [
    { corpId: 'c1', action: { type: 'trade', withCorpId: 'c2', offer: { energy: 5 }, request: { credits: 10 } } },
    { corpId: 'c2', action: { type: 'trade', withCorpId: 'c1', offer: { credits: 10 }, request: { energy: 5 } } },
  ]);

  const c1 = db.prepare('SELECT * FROM corporations WHERE id = ?').get('c1');
  const c2 = db.prepare('SELECT * FROM corporations WHERE id = ?').get('c2');
  // c1: loses 5 energy + 2C fee, gains 10 credits → energy=5, credits=58
  expect(c1.energy).toBe(5);
  expect(c1.credits).toBe(58); // 50 - 2 fee + 10 received
  // c2: loses 10 credits + 2C fee, gains 5 energy → credits=-2
  expect(c2.energy).toBe(55); // 50 + 5
  expect(c2.credits).toBe(-2); // 10 - 10 - 2 (negative credits allowed per spec)
});

test('unmatched trade is silently dropped', () => {
  makeCorp('c1', 'Corp1');
  makeCorp('c2', 'Corp2');

  resolveTrades(db, seasonId, 1, [
    { corpId: 'c1', action: { type: 'trade', withCorpId: 'c2', offer: { energy: 5 }, request: { credits: 10 } } },
    // c2 offers different terms
    { corpId: 'c2', action: { type: 'trade', withCorpId: 'c1', offer: { credits: 5 }, request: { energy: 5 } } },
  ]);

  const c1 = db.prepare('SELECT * FROM corporations WHERE id = ?').get('c1');
  expect(c1.energy).toBe(50); // unchanged
});

test('allied trade: fee waived', () => {
  makeCorp('c1', 'Corp1', { credits: 50, energy: 10 });
  makeCorp('c2', 'Corp2', { credits: 10, energy: 50 });
  db.prepare('INSERT INTO alliances (id, corp_a_id, corp_b_id, proposed_tick, formed_tick) VALUES (?, ?, ?, ?, ?)')
    .run('a1', 'c1', 'c2', 1, 1);

  resolveTrades(db, seasonId, 2, [
    { corpId: 'c1', action: { type: 'trade', withCorpId: 'c2', offer: { energy: 5 }, request: { credits: 10 } } },
    { corpId: 'c2', action: { type: 'trade', withCorpId: 'c1', offer: { credits: 10 }, request: { energy: 5 } } },
  ]);

  const c1 = db.prepare('SELECT * FROM corporations WHERE id = ?').get('c1');
  expect(c1.credits).toBe(60); // 50 + 10, no fee
});

test('embargoed trade is blocked', () => {
  makeCorp('c1', 'Corp1', { credits: 50, energy: 10 });
  makeCorp('c2', 'Corp2', { credits: 10, energy: 50 });
  db.prepare('INSERT INTO embargoes (id, corp_id, target_corp_id, expires_tick) VALUES (?, ?, ?, ?)')
    .run('e1', 'c1', 'c2', 5);

  resolveTrades(db, seasonId, 1, [
    { corpId: 'c1', action: { type: 'trade', withCorpId: 'c2', offer: { energy: 5 }, request: { credits: 10 } } },
    { corpId: 'c2', action: { type: 'trade', withCorpId: 'c1', offer: { credits: 10 }, request: { energy: 5 } } },
  ]);

  const c1 = db.prepare('SELECT * FROM corporations WHERE id = ?').get('c1');
  expect(c1.energy).toBe(10); // unchanged
});
