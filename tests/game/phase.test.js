const Database = require('better-sqlite3');
const { initDb } = require('../../src/db/schema');
const { createSeason } = require('../../src/game/world');
const { checkPhase } = require('../../src/game/phase');

let db, seasonId;

function makeCorp(id, name, credits = 100) {
  db.prepare('INSERT INTO corporations (id, season_id, name, api_key, credits) VALUES (?, ?, ?, ?, ?)')
    .run(id, seasonId, name, `key-${id}`, credits);
}

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);
  // Open phase 1
  db.prepare('INSERT INTO phases (id, season_id, phase_number, start_tick) VALUES (?, ?, 1, 1)')
    .run('phase-1', seasonId);
});
afterEach(() => db.close());

test('checkPhase does nothing when tick % 10 !== 0', () => {
  checkPhase(db, seasonId, 5);
  const law = db.prepare("SELECT * FROM laws WHERE season_id = ? AND is_active = 1").get(seasonId);
  expect(law).toBeUndefined();
});

test('checkPhase at tick 10 activates a law', () => {
  checkPhase(db, seasonId, 10);
  const law = db.prepare("SELECT * FROM laws WHERE season_id = ? AND is_active = 1").get(seasonId);
  expect(law).toBeDefined();
});

test('checkPhase closes the current phase and opens a new one', () => {
  checkPhase(db, seasonId, 10);
  const closedPhase = db.prepare("SELECT * FROM phases WHERE id = 'phase-1'").get();
  expect(closedPhase.end_tick).toBe(10);
  const newPhase = db.prepare("SELECT * FROM phases WHERE season_id = ? AND end_tick IS NULL").get(seasonId);
  expect(newPhase).toBeDefined();
  expect(newPhase.phase_number).toBe(2);
  expect(newPhase.start_tick).toBe(11);
});

test('voted law has higher probability of selection', () => {
  // Vote heavily for Data Sovereignty Act
  makeCorp('c1', 'Voter');
  const dsaId = db.prepare("SELECT id FROM laws WHERE season_id = ? AND effect = 'data_center_bonus'").get(seasonId).id;
  // Insert 100 credits of votes for DSA
  db.prepare('INSERT INTO lobby_votes (id, phase_id, corp_id, law_id, credits) VALUES (?, ?, ?, ?, ?)')
    .run('v1', 'phase-1', 'c1', dsaId, 100);

  // Run 50 times, DSA should win most of the time
  let dsaWins = 0;
  for (let i = 0; i < 50; i++) {
    // Reset: deactivate all laws
    db.prepare("UPDATE laws SET is_active = 0 WHERE season_id = ?").run(seasonId);
    checkPhase(db, seasonId, 10);
    const active = db.prepare("SELECT * FROM laws WHERE season_id = ? AND is_active = 1").get(seasonId);
    if (active && active.id === dsaId) dsaWins++;
    // Reset: reopen phase-1, delete any new phases opened by checkPhase
    db.prepare("UPDATE phases SET end_tick = NULL, resolved_law_id = NULL WHERE id = 'phase-1'").run();
    db.prepare("DELETE FROM phases WHERE season_id = ? AND id != 'phase-1'").run(seasonId);
  }
  expect(dsaWins).toBeGreaterThan(35); // statistically, should win ~88% with 100 votes vs 7 others at 0
});
