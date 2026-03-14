// tests/game/tick.test.js
const Database = require('better-sqlite3');
const crypto = require('crypto');
const { initDb } = require('../../src/db/schema');
const { createSeason, createDistrictMap } = require('../../src/game/world');
const { runTick } = require('../../src/game/tick');

// Simple UUID v4 implementation for CommonJS compatibility
function uuidv4() {
  return crypto.randomUUID();
}

let db, seasonId, corpId;

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);

  corpId = uuidv4();
  db.prepare(`INSERT INTO corporations (id, season_id, name, api_key, credits) VALUES (?, ?, 'TestCorp', ?, 0)`)
    .run(corpId, seasonId, uuidv4());
  // Assign one financial_hub to the corp
  db.prepare(`
    UPDATE districts SET owner_id = ?
    WHERE id = (SELECT id FROM districts WHERE season_id = ? AND type = 'financial_hub' AND owner_id IS NULL LIMIT 1)
  `).run(corpId, seasonId);
});
afterEach(() => db.close());

test('runTick increments tick_count on the season', () => {
  runTick(db, seasonId);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  expect(season.tick_count).toBe(1);
});

test('runTick generates resources for corps', () => {
  runTick(db, seasonId);
  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(corpId);
  expect(corp.credits).toBe(4); // one financial_hub = +4 credits
});

test('runTick stores a briefing for each corp', () => {
  runTick(db, seasonId);
  const briefing = db.prepare('SELECT * FROM briefings WHERE corp_id = ?').get(corpId);
  expect(briefing).toBeDefined();
  expect(briefing.tick).toBe(1);
  const payload = JSON.parse(briefing.payload);
  expect(payload.resources.credits).toBe(4);
});

test('runTick does not run on completed seasons', () => {
  db.prepare("UPDATE seasons SET status = 'complete' WHERE id = ?").run(seasonId);
  runTick(db, seasonId);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  expect(season.tick_count).toBe(0);
});

test('runTick overwrites briefing on second run (UNIQUE constraint)', () => {
  runTick(db, seasonId);
  runTick(db, seasonId);
  const briefings = db.prepare('SELECT * FROM briefings WHERE corp_id = ?').all(corpId);
  expect(briefings).toHaveLength(2); // tick 1 and tick 2
});

test('runTick calls resolveActions — pending action gets resolved', () => {
  // Give corp enough resources for a claim (3E, 5C)
  db.prepare('UPDATE corporations SET energy = 10, credits = 10 WHERE id = ?').run(corpId);

  // Find an unclaimed district adjacent to the corp's owned district
  const ownedDistrict = db.prepare(
    'SELECT * FROM districts WHERE owner_id = ? LIMIT 1'
  ).get(corpId);
  const adjacentIds = JSON.parse(ownedDistrict.adjacent_ids);
  const targetDistrictId = adjacentIds[0];

  // Submit a pending action for tick 0 (will be resolved when tick becomes 1)
  const actionId = uuidv4();
  const parsedActions = JSON.stringify({
    primaryAction: { type: 'claim', targetDistrictId },
    freeActions: [],
  });
  db.prepare(`
    INSERT INTO pending_actions (id, corp_id, tick, parsed_actions, status)
    VALUES (?, ?, 0, ?, 'pending')
  `).run(actionId, corpId, parsedActions);

  // runTick increments to tick 1, then resolves actions for tick 0
  runTick(db, seasonId);

  const action = db.prepare('SELECT * FROM pending_actions WHERE id = ?').get(actionId);
  expect(action.status).toBe('resolved');
});

test('buildBriefingPayload includes pendingAlliances', () => {
  // Create a second corp that will propose an alliance to corpId
  const proposerCorpId = uuidv4();
  db.prepare(`INSERT INTO corporations (id, season_id, name, api_key) VALUES (?, ?, 'ProposerCorp', ?)`)
    .run(proposerCorpId, seasonId, uuidv4());

  // Insert a pending alliance: corp_a = proposer, corp_b = corpId
  // formed_tick IS NULL and broken_tick IS NULL = pending
  db.prepare(`
    INSERT INTO alliances (id, corp_a_id, corp_b_id, proposed_tick)
    VALUES (?, ?, ?, 0)
  `).run(uuidv4(), proposerCorpId, corpId);

  runTick(db, seasonId);

  const briefing = db.prepare('SELECT * FROM briefings WHERE corp_id = ?').get(corpId);
  const payload = JSON.parse(briefing.payload);
  expect(payload.pendingAlliances).toBeInstanceOf(Array);
  expect(payload.pendingAlliances).toHaveLength(1);
  expect(payload.pendingAlliances[0].proposing_corp_id).toBe(proposerCorpId);
  expect(payload.pendingAlliances[0].proposing_corp_name).toBe('ProposerCorp');
});
