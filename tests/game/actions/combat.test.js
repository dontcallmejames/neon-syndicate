const Database = require('better-sqlite3');
const { initDb } = require('../../../src/db/schema');
const { createSeason, createDistrictMap } = require('../../../src/game/world');
const { resolveCombat } = require('../../../src/game/actions/combat');

let db, seasonId, districtIds;

function makeCorp(id, name, overrides = {}) {
  db.prepare(`
    INSERT INTO corporations (id, season_id, name, api_key, credits, energy, workforce, reputation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, seasonId, name, `key-${id}`,
    overrides.credits ?? 50, overrides.energy ?? 50,
    overrides.workforce ?? 10, overrides.reputation ?? 50);
}

function getDistrict(index) {
  return db.prepare('SELECT * FROM districts WHERE season_id = ? LIMIT 1 OFFSET ?').get(seasonId, index);
}

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
  districtIds = createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);
});
afterEach(() => db.close());

test('successful claim: corp with 0 districts can claim any unclaimed district', () => {
  makeCorp('c1', 'Corp1');
  const target = db.prepare("SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1").get(seasonId);
  resolveCombat(db, seasonId, 1, [
    { corpId: 'c1', action: { type: 'claim', targetDistrictId: target.id } }
  ]);
  const d = db.prepare('SELECT owner_id FROM districts WHERE id = ?').get(target.id);
  expect(d.owner_id).toBe('c1');
});

test('claim consumes 3 energy and 5 credits', () => {
  makeCorp('c1', 'Corp1', { energy: 10, credits: 10 });
  const target = db.prepare("SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1").get(seasonId);
  resolveCombat(db, seasonId, 1, [
    { corpId: 'c1', action: { type: 'claim', targetDistrictId: target.id } }
  ]);
  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get('c1');
  expect(corp.energy).toBe(7);
  expect(corp.credits).toBe(5);
});

test('successful attack: attacker takes district, fortification resets', () => {
  makeCorp('attacker', 'Attacker', { energy: 50, workforce: 10 });
  makeCorp('defender', 'Defender', { workforce: 0 });
  const target = db.prepare("SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1").get(seasonId);
  db.prepare('UPDATE districts SET owner_id = ?, fortification_level = 5 WHERE id = ?').run('defender', target.id);

  // energySpent=20 → attackStrength = 20*1.5 + 10 = 40; defense = 5 + 0 = 5 → attack wins
  resolveCombat(db, seasonId, 1, [
    { corpId: 'attacker', action: { type: 'attack', targetDistrictId: target.id, energySpent: 20 } }
  ]);

  const d = db.prepare('SELECT * FROM districts WHERE id = ?').get(target.id);
  expect(d.owner_id).toBe('attacker');
  expect(d.fortification_level).toBe(0);
});

test('failed attack: district holds, attacker loses energy and credits', () => {
  makeCorp('attacker', 'Attacker', { energy: 50, credits: 50, workforce: 0 });
  makeCorp('defender', 'Defender', { workforce: 20 });
  const target = db.prepare("SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1").get(seasonId);
  db.prepare('UPDATE districts SET owner_id = ?, fortification_level = 0 WHERE id = ?').run('defender', target.id);

  // energySpent=5 → attackStrength = 5*1.5 + 0 = 7.5; defense = 0 + 20 = 20 → fails
  resolveCombat(db, seasonId, 1, [
    { corpId: 'attacker', action: { type: 'attack', targetDistrictId: target.id, energySpent: 5 } }
  ]);

  const d = db.prepare('SELECT owner_id FROM districts WHERE id = ?').get(target.id);
  expect(d.owner_id).toBe('defender'); // unchanged
  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get('attacker');
  expect(corp.energy).toBe(45); // 50 - 5
  expect(corp.credits).toBe(40); // 50 - 10
  expect(corp.reputation).toBe(47); // 50 - 3
});

test('attack: reputation -3 regardless of outcome', () => {
  makeCorp('attacker', 'Attacker', { energy: 50, workforce: 100 });
  makeCorp('defender', 'Defender', { workforce: 0 });
  const target = db.prepare("SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1").get(seasonId);
  db.prepare('UPDATE districts SET owner_id = ? WHERE id = ?').run('defender', target.id);

  resolveCombat(db, seasonId, 1, [
    { corpId: 'attacker', action: { type: 'attack', targetDistrictId: target.id, energySpent: 5 } }
  ]);
  const corp = db.prepare('SELECT reputation FROM corporations WHERE id = ?').get('attacker');
  expect(corp.reputation).toBe(47); // -3
});
