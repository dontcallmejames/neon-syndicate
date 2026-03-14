const Database = require('better-sqlite3');
const { initDb } = require('../../../src/db/schema');
const { createSeason, createDistrictMap } = require('../../../src/game/world');
const { validateActions } = require('../../../src/game/actions/validate');

let db, seasonId;

function makeCorp(overrides = {}) {
  const id = `corp-${Date.now()}-${Math.random()}`;
  db.prepare(`
    INSERT INTO corporations (id, season_id, name, api_key, credits, energy, workforce, intelligence, influence, political_power, reputation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, seasonId, overrides.name || 'TestCorp', `key-${id}`,
    overrides.credits ?? 20, overrides.energy ?? 20,
    overrides.workforce ?? 6, overrides.intelligence ?? 4,
    overrides.influence ?? 10, overrides.politicalPower ?? 0,
    overrides.reputation ?? 50
  );
  return db.prepare('SELECT * FROM corporations WHERE id = ?').get(id);
}

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);
});
afterEach(() => db.close());

test('valid claim action passes validation', () => {
  const corp = makeCorp({ energy: 10, credits: 10 });
  const target = db.prepare(
    "SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1"
  ).get(seasonId);
  // Give corp one district so adjacency isn't required (corp has 0 districts → any unclaimed allowed)
  const result = validateActions(db, corp, {
    primaryAction: { type: 'claim', targetDistrictId: target.id },
    freeActions: [],
  }, 1);
  expect(result.valid).toBe(true);
});

test('claim fails with insufficient energy', () => {
  const corp = makeCorp({ energy: 2, credits: 10 });
  const target = db.prepare(
    "SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1"
  ).get(seasonId);
  const result = validateActions(db, corp, {
    primaryAction: { type: 'claim', targetDistrictId: target.id },
    freeActions: [],
  }, 1);
  expect(result.valid).toBe(false);
  expect(result.reason).toMatch(/energy/i);
});

test('attack fails below minimum energy spend', () => {
  const corp = makeCorp({ energy: 10, credits: 20 });
  const result = validateActions(db, corp, {
    primaryAction: { type: 'attack', targetDistrictId: 'some-id', energySpent: 3 },
    freeActions: [],
  }, 1);
  expect(result.valid).toBe(false);
  expect(result.reason).toMatch(/minimum/i);
});

test('attack fails with insufficient energy for the spend', () => {
  const corp = makeCorp({ energy: 4, credits: 20 });
  const result = validateActions(db, corp, {
    primaryAction: { type: 'attack', targetDistrictId: 'some-id', energySpent: 5 },
    freeActions: [],
  }, 1);
  expect(result.valid).toBe(false);
});

test('counter_intelligence fails without intelligence >= 10', () => {
  const corp = makeCorp({ energy: 10, influence: 10, intelligence: 8 });
  const result = validateActions(db, corp, {
    primaryAction: { type: 'counter_intelligence' },
    freeActions: [],
  }, 1);
  expect(result.valid).toBe(false);
  expect(result.reason).toMatch(/intelligence/i);
});

test('corporate_assassination blocked for non-Pariah', () => {
  const corp = makeCorp({ reputation: 50 });
  const result = validateActions(db, corp, {
    primaryAction: { type: 'corporate_assassination', targetCorpId: 'x' },
    freeActions: [],
  }, 1);
  expect(result.valid).toBe(false);
  expect(result.reason).toMatch(/pariah/i);
});

test('corporate_assassination allowed for Pariah', () => {
  const corp = makeCorp({ reputation: 10, energy: 20, credits: 20, influence: 15 });
  const result = validateActions(db, corp, {
    primaryAction: { type: 'corporate_assassination', targetCorpId: 'x' },
    freeActions: [],
  }, 1);
  expect(result.valid).toBe(true);
});

test('Pariah covert op: influence cost waived', () => {
  const corp = makeCorp({ reputation: 10, energy: 10, credits: 20, influence: 0 });
  const target = db.prepare(
    "SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1"
  ).get(seasonId);
  const result = validateActions(db, corp, {
    primaryAction: { type: 'sabotage', targetDistrictId: target.id },
    freeActions: [],
  }, 1);
  expect(result.valid).toBe(true);
});

test('open_borders law halves claim cost', () => {
  const corp = makeCorp({ energy: 1, credits: 2 }); // would fail without open_borders (needs 3e/5c)
  db.prepare("UPDATE laws SET is_active = 1 WHERE season_id = ? AND effect = 'open_borders'").run(seasonId);
  const target = db.prepare(
    "SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1"
  ).get(seasonId);
  const result = validateActions(db, corp, {
    primaryAction: { type: 'claim', targetDistrictId: target.id },
    freeActions: [],
  }, 1);
  expect(result.valid).toBe(true); // floor(3*0.5)=1 energy, floor(5*0.5)=2 credits
});

test('lobby blocked for Pariah', () => {
  const corp = makeCorp({ reputation: 10, credits: 50 });
  const lawId = db.prepare("SELECT id FROM laws WHERE season_id = ? LIMIT 1").get(seasonId).id;
  const phaseId = 'phase-1';
  db.prepare('INSERT INTO phases (id, season_id, phase_number, start_tick) VALUES (?, ?, 1, 1)')
    .run(phaseId, seasonId);
  const result = validateActions(db, corp, {
    primaryAction: null,
    freeActions: [{ type: 'lobby', lawId, credits: 10 }],
  }, 1);
  expect(result.valid).toBe(false);
  expect(result.reason).toMatch(/pariah/i);
});

test('fortify_discount law halves fortify credit cost', () => {
  const corp = makeCorp({ energy: 10, credits: 3 }); // fortify normally costs 8C; with discount = 4C; corp has only 3 → fails
  db.prepare("UPDATE laws SET is_active = 1 WHERE season_id = ? AND effect = 'fortify_discount'").run(seasonId);
  const target = db.prepare("SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1").get(seasonId);
  const withoutLaw = validateActions(db, corp, { primaryAction: { type: 'fortify', targetDistrictId: target.id }, freeActions: [] }, 1);
  // Without law: needs 8C, corp has 3 → invalid
  expect(withoutLaw.valid).toBe(false);
  // Now with law active (already set above): needs floor(8*0.5)=4C, corp has 3 → still invalid
  // Re-test: give corp 4C
  db.prepare('UPDATE corporations SET credits = 4 WHERE id = ?').run(corp.id);
  const updated = db.prepare('SELECT * FROM corporations WHERE id = ?').get(corp.id);
  const withLaw = validateActions(db, updated, { primaryAction: { type: 'fortify', targetDistrictId: target.id }, freeActions: [] }, 1);
  expect(withLaw.valid).toBe(true); // floor(8*0.5)=4C, corp has 4 → valid
});

test('security_lockdown doubles sabotage energy cost', () => {
  const corp = makeCorp({ energy: 7, credits: 20, influence: 10 }); // sabotage normally costs 4E; lockdown → 8E
  db.prepare("UPDATE laws SET is_active = 1 WHERE season_id = ? AND effect = 'security_lockdown'").run(seasonId);
  const target = db.prepare("SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1").get(seasonId);
  const result = validateActions(db, corp, { primaryAction: { type: 'sabotage', targetDistrictId: target.id }, freeActions: [] }, 1);
  expect(result.valid).toBe(false); // need 8E, have 7
  expect(result.reason).toMatch(/energy/i);
});

test('crackdown doubles sabotage influence cost', () => {
  const corp = makeCorp({ energy: 10, credits: 20, influence: 8 }); // sabotage normally costs 5I; crackdown → 10I
  db.prepare("UPDATE laws SET is_active = 1 WHERE season_id = ? AND effect = 'crackdown'").run(seasonId);
  const target = db.prepare("SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1").get(seasonId);
  const result = validateActions(db, corp, { primaryAction: { type: 'sabotage', targetDistrictId: target.id }, freeActions: [] }, 1);
  expect(result.valid).toBe(false); // need 10I, have 8
  expect(result.reason).toMatch(/influence/i);
});

test('labor_zone_attack_cost adds 5 energy when attacking labor_zone', () => {
  db.prepare("UPDATE laws SET is_active = 1 WHERE season_id = ? AND effect = 'labor_zone_attack_cost'").run(seasonId);
  const lz = db.prepare("SELECT id FROM districts WHERE season_id = ? AND type = 'labor_zone' LIMIT 1").get(seasonId);
  const corp = makeCorp({ energy: 9, credits: 20 }); // attack with energySpent=5 + 5 law penalty = 10E total; corp has 9 → fail
  const result = validateActions(db, corp, { primaryAction: { type: 'attack', targetDistrictId: lz.id, energySpent: 5 }, freeActions: [] }, 1);
  expect(result.valid).toBe(false); // need 10E, have 9
});

test('lobby rejected when lawId does not exist in DB', () => {
  const corp = makeCorp({ reputation: 50, credits: 50 });
  const result = validateActions(db, corp, {
    primaryAction: null,
    freeActions: [{ type: 'lobby', lawId: 'nonexistent-law-id', credits: 10 }],
  }, 1);
  expect(result.valid).toBe(false);
  expect(result.reason).toMatch(/not found/i);
});

test('lobby rejected when credits below minimum (10)', () => {
  const corp = makeCorp({ reputation: 50, credits: 50 });
  const lawId = db.prepare("SELECT id FROM laws WHERE season_id = ? LIMIT 1").get(seasonId).id;
  const result = validateActions(db, corp, {
    primaryAction: null,
    freeActions: [{ type: 'lobby', lawId, credits: 8 }],
  }, 1);
  expect(result.valid).toBe(false);
  expect(result.reason).toMatch(/credits/i);
});

test('Trusted corp lobby minimum is 8 credits', () => {
  const corp = makeCorp({ reputation: 80, credits: 50 });
  const lawId = db.prepare("SELECT id FROM laws WHERE season_id = ? LIMIT 1").get(seasonId).id;
  const result = validateActions(db, corp, {
    primaryAction: null,
    freeActions: [{ type: 'lobby', lawId, credits: 8 }],
  }, 1);
  expect(result.valid).toBe(true); // Trusted: min is 8, not 10
});
