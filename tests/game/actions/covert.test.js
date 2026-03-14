const Database = require('better-sqlite3');
const { initDb } = require('../../../src/db/schema');
const { createSeason, createDistrictMap } = require('../../../src/game/world');
const { resolveCovert } = require('../../../src/game/actions/covert');

let db, seasonId;

function makeCorp(id, name, overrides = {}) {
  db.prepare(`
    INSERT INTO corporations (id, season_id, name, api_key, credits, energy, workforce, influence, reputation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, seasonId, name, `key-${id}`,
    overrides.credits ?? 50, overrides.energy ?? 50,
    overrides.workforce ?? 6, overrides.influence ?? 10,
    overrides.reputation ?? 50);
}

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);
});
afterEach(() => db.close());

test('sabotage sets sabotaged_until = tick + 2', () => {
  makeCorp('attacker', 'A');
  makeCorp('victim', 'V');
  const target = db.prepare("SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1").get(seasonId);
  db.prepare('UPDATE districts SET owner_id = ? WHERE id = ?').run('victim', target.id);

  resolveCovert(db, seasonId, 3, [
    { corpId: 'attacker', action: { type: 'sabotage', targetDistrictId: target.id } }
  ]);

  const d = db.prepare('SELECT sabotaged_until FROM districts WHERE id = ?').get(target.id);
  expect(d.sabotaged_until).toBe(5); // tick 3 + 2
});

test('sabotage costs 4 energy, 15 credits, and -5 reputation', () => {
  makeCorp('attacker', 'A', { energy: 10, credits: 20, reputation: 50 });
  makeCorp('victim', 'V');
  const target = db.prepare("SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1").get(seasonId);
  db.prepare('UPDATE districts SET owner_id = ? WHERE id = ?').run('victim', target.id);

  resolveCovert(db, seasonId, 1, [
    { corpId: 'attacker', action: { type: 'sabotage', targetDistrictId: target.id } }
  ]);

  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get('attacker');
  expect(corp.energy).toBe(6);
  expect(corp.credits).toBe(5);
  expect(corp.reputation).toBe(45);
});

test('leak_scandal reduces target reputation by 8', () => {
  makeCorp('attacker', 'A');
  makeCorp('victim', 'V', { reputation: 50 });

  resolveCovert(db, seasonId, 1, [
    { corpId: 'attacker', action: { type: 'leak_scandal', targetCorpId: 'victim' } }
  ]);

  const victim = db.prepare('SELECT reputation FROM corporations WHERE id = ?').get('victim');
  expect(victim.reputation).toBe(42); // 50 - 8
});

test('corporate_assassination reduces target reputation by 25', () => {
  makeCorp('pariah', 'P', { reputation: 10 });
  makeCorp('target', 'T', { reputation: 70 });

  resolveCovert(db, seasonId, 1, [
    { corpId: 'pariah', action: { type: 'corporate_assassination', targetCorpId: 'target' } }
  ]);

  const target = db.prepare('SELECT reputation FROM corporations WHERE id = ?').get('target');
  expect(target.reputation).toBe(45); // 70 - 25
});

test('fortify adds 5 to fortification_level (capped at 20)', () => {
  makeCorp('corp', 'C');
  const ownedDistrict = db.prepare("SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1").get(seasonId);
  db.prepare('UPDATE districts SET owner_id = ?, fortification_level = 17 WHERE id = ?').run('corp', ownedDistrict.id);

  resolveCovert(db, seasonId, 1, [
    { corpId: 'corp', action: { type: 'fortify', targetDistrictId: ownedDistrict.id } }
  ]);

  const d = db.prepare('SELECT fortification_level FROM districts WHERE id = ?').get(ownedDistrict.id);
  expect(d.fortification_level).toBe(20); // 17 + 5, but capped
});
