const Database = require('better-sqlite3');
const { initDb } = require('../../../src/db/schema');
const { createSeason, createDistrictMap } = require('../../../src/game/world');
const { resolveActions } = require('../../../src/game/actions/resolve');

let db, seasonId;

function makeCorp(id, name, overrides = {}) {
  db.prepare(`
    INSERT INTO corporations (id, season_id, name, api_key, credits, energy, workforce, influence, intelligence, reputation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, seasonId, name, `key-${id}`,
    overrides.credits ?? 50, overrides.energy ?? 50,
    overrides.workforce ?? 6, overrides.influence ?? 10,
    overrides.intelligence ?? 4, overrides.reputation ?? 50);
}

function submitAction(corpId, tick, parsedActions) {
  db.prepare(`
    INSERT INTO pending_actions (id, corp_id, tick, parsed_actions, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(`pa-${corpId}`, corpId, tick, JSON.stringify(parsedActions));
}

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);
  db.prepare('INSERT INTO phases (id, season_id, phase_number, start_tick) VALUES (?, ?, 1, 1)')
    .run('phase-1', seasonId);
});
afterEach(() => db.close());

test('resolveActions processes a claim action end-to-end', () => {
  makeCorp('c1', 'Corp1', { energy: 10, credits: 10 });
  const target = db.prepare("SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1").get(seasonId);
  submitAction('c1', 1, { primaryAction: { type: 'claim', targetDistrictId: target.id }, freeActions: [] });

  resolveActions(db, seasonId, 1);

  const d = db.prepare('SELECT owner_id FROM districts WHERE id = ?').get(target.id);
  expect(d.owner_id).toBe('c1');
  const action = db.prepare('SELECT status FROM pending_actions WHERE corp_id = ?').get('c1');
  expect(action.status).toBe('resolved');
});

test('invalid actions are rejected', () => {
  makeCorp('c1', 'Corp1', { energy: 1, credits: 1 });
  const target = db.prepare("SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1").get(seasonId);
  submitAction('c1', 1, { primaryAction: { type: 'claim', targetDistrictId: target.id }, freeActions: [] });

  resolveActions(db, seasonId, 1);

  const action = db.prepare('SELECT status FROM pending_actions WHERE corp_id = ?').get('c1');
  expect(action.status).toBe('rejected');
  const d = db.prepare('SELECT owner_id FROM districts WHERE id = ?').get(target.id);
  expect(d.owner_id).toBeNull();
});

test('CI nullifies sabotage targeting the CI corp', () => {
  makeCorp('ci-corp', 'CIUser', { energy: 20, influence: 10, intelligence: 15 });
  makeCorp('saboteur', 'Saboteur', { energy: 20, credits: 50, influence: 10 });
  const targetD = db.prepare("SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1").get(seasonId);
  db.prepare('UPDATE districts SET owner_id = ? WHERE id = ?').run('ci-corp', targetD.id);

  submitAction('ci-corp', 1, { primaryAction: { type: 'counter_intelligence' }, freeActions: [] });
  submitAction('saboteur', 1, { primaryAction: { type: 'sabotage', targetDistrictId: targetD.id }, freeActions: [] });

  resolveActions(db, seasonId, 1);

  // Saboteur's costs should still be consumed
  const saboteur = db.prepare('SELECT * FROM corporations WHERE id = ?').get('saboteur');
  expect(saboteur.energy).toBeLessThan(20);
  // But the district should NOT be sabotaged
  const d = db.prepare('SELECT sabotaged_until FROM districts WHERE id = ?').get(targetD.id);
  expect(d.sabotaged_until).toBe(0);
});

test('counter_intelligence deducts costs from CI corp', () => {
  makeCorp('ci-corp', 'CIUser', { energy: 10, influence: 10, intelligence: 15 });
  submitAction('ci-corp', 1, { primaryAction: { type: 'counter_intelligence' }, freeActions: [] });

  resolveActions(db, seasonId, 1);

  const corp = db.prepare('SELECT energy, influence FROM corporations WHERE id = ?').get('ci-corp');
  expect(corp.energy).toBe(7);
  expect(corp.influence).toBe(5);
});

test('CI nullification under security_lockdown deducts doubled energy from attacker', () => {
  // Activate the pre-existing security_lockdown law
  db.prepare("UPDATE laws SET is_active = 1 WHERE season_id = ? AND effect = 'security_lockdown'")
    .run(seasonId);

  makeCorp('ci-corp', 'CIUser', { energy: 20, influence: 10, intelligence: 15 });
  makeCorp('attacker', 'Attacker', { energy: 30, credits: 50, influence: 20 });

  const targetD = db.prepare("SELECT id FROM districts WHERE season_id = ? AND owner_id IS NULL LIMIT 1").get(seasonId);
  db.prepare('UPDATE districts SET owner_id = ? WHERE id = ?').run('ci-corp', targetD.id);

  submitAction('ci-corp', 1, { primaryAction: { type: 'counter_intelligence' }, freeActions: [] });
  submitAction('attacker', 1, { primaryAction: { type: 'sabotage', targetDistrictId: targetD.id }, freeActions: [] });

  resolveActions(db, seasonId, 1);

  // Under security_lockdown, sabotage energy cost doubles from 4 to 8
  const attacker = db.prepare('SELECT energy FROM corporations WHERE id = ?').get('attacker');
  expect(attacker.energy).toBe(22); // 30 - 8
});

test('feared mechanic applied during resolve', () => {
  makeCorp('pariah-corp', 'Pariah', { credits: 0, reputation: 10 });
  makeCorp('rich-corp', 'Rich', { credits: 100 });

  resolveActions(db, seasonId, 1); // no pending actions

  const pariah = db.prepare('SELECT credits FROM corporations WHERE id = ?').get('pariah-corp');
  expect(pariah.credits).toBeGreaterThanOrEqual(5);
});
