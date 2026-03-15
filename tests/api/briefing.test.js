// tests/api/briefing.test.js
const request = require('supertest');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const { initDb } = require('../../src/db/schema');
const { createSeason, createDistrictMap } = require('../../src/game/world');
const { createServer } = require('../../src/api/server');

// Simple UUID v4 implementation for CommonJS compatibility
function uuidv4() {
  return crypto.randomUUID();
}

let app, db, apiKey, corpId, seasonId;

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);
  ({ app } = createServer(db));

  corpId = uuidv4();
  apiKey = uuidv4();
  db.prepare(`INSERT INTO corporations (id, season_id, name, api_key) VALUES (?, ?, 'TestCorp', ?)`)
    .run(corpId, seasonId, apiKey);
});
afterEach(() => db.close());

test('GET /briefing/:agentId returns 401 without auth', async () => {
  const res = await request(app).get(`/briefing/${corpId}`);
  expect(res.status).toBe(401);
});

test('GET /briefing/:agentId returns structured briefing', async () => {
  const res = await request(app)
    .get(`/briefing/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`);

  expect(res.status).toBe(200);
  expect(typeof res.body.tick).toBe('number');
  expect(res.body.generating).toBe(false);
  expect(res.body.resources).toHaveProperty('credits');
  expect(res.body.resources).toHaveProperty('energy');
  expect(res.body.holdings).toBeInstanceOf(Array);
  expect(res.body.alliances).toBeInstanceOf(Array);
  expect(res.body.availableActions).toBeInstanceOf(Array);
});

test('GET /briefing/:agentId returns 403 if agentId does not match auth token', async () => {
  const res = await request(app)
    .get(`/briefing/${uuidv4()}`)
    .set('Authorization', `Bearer ${apiKey}`);
  expect(res.status).toBe(403);
});

test('GET /briefing/:agentId returns stored briefing when available', async () => {
  const payload = { tick: 5, generating: false, resources: { credits: 99 } };
  db.prepare(`INSERT INTO briefings (id, corp_id, tick, payload) VALUES (?, ?, 5, ?)`)
    .run(uuidv4(), corpId, JSON.stringify(payload));
  db.prepare('UPDATE seasons SET tick_count = 5 WHERE id = ?').run(seasonId);

  const res = await request(app)
    .get(`/briefing/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`);

  expect(res.body.resources.credits).toBe(99);
});

test('buildAvailableActions is exported from briefing.js', () => {
  const { buildAvailableActions } = require('../../src/api/routes/briefing');
  expect(typeof buildAvailableActions).toBe('function');
  const actions = buildAvailableActions(false);
  expect(Array.isArray(actions)).toBe(true);
  expect(actions.length).toBeGreaterThan(0);
});

test('GET /briefing/:agentId live path returns narrative as non-null string', async () => {
  const res = await request(app)
    .get(`/briefing/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`);

  expect(res.status).toBe(200);
  expect(typeof res.body.narrative).toBe('string');
  expect(res.body.narrative.length).toBeGreaterThan(0);
});

test('GET /briefing/:agentId returns pendingAlliances', async () => {
  // Create a proposing corp
  const proposerCorpId = uuidv4();
  db.prepare(`INSERT INTO corporations (id, season_id, name, api_key) VALUES (?, ?, 'ProposerCorp', ?)`)
    .run(proposerCorpId, seasonId, uuidv4());

  // Insert a pending alliance: corp_a = proposer, corp_b = corpId (receiver)
  // formed_tick IS NULL, broken_tick IS NULL = pending proposal
  db.prepare(`
    INSERT INTO alliances (id, corp_a_id, corp_b_id, proposed_tick)
    VALUES (?, ?, ?, 0)
  `).run(uuidv4(), proposerCorpId, corpId);

  const res = await request(app)
    .get(`/briefing/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`);

  expect(res.status).toBe(200);
  expect(res.body.pendingAlliances).toBeInstanceOf(Array);
  expect(res.body.pendingAlliances).toHaveLength(1);
  expect(res.body.pendingAlliances[0].proposing_corp_id).toBe(proposerCorpId);
  expect(res.body.pendingAlliances[0].proposing_corp_name).toBe('ProposerCorp');
});

test('GET /briefing/:agentId includes nextTickAt in response', async () => {
  const res = await request(app)
    .get(`/briefing/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`);

  expect(res.status).toBe(200);
  expect(typeof res.body.nextTickAt).toBe('number');
});
