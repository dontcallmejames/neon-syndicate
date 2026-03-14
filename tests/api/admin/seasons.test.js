// tests/api/admin/seasons.test.js
const request = require('supertest');
const Database = require('better-sqlite3');
const { initDb } = require('../../../src/db/schema');
const { createServer } = require('../../../src/api/server');
const { createSeason, createDistrictMap } = require('../../../src/game/world');

const ADMIN_KEY = 'test-key';
const AUTH = { Authorization: `Bearer ${ADMIN_KEY}` };

let app, db;

beforeEach(() => {
  process.env.ADMIN_KEY = ADMIN_KEY;
  db = new Database(':memory:');
  initDb(db);
  ({ app } = createServer(db));
});

afterEach(() => {
  delete process.env.ADMIN_KEY;
  db.close();
});

// --- POST /admin/seasons ---

test('POST /admin/seasons creates season with defaults', async () => {
  const res = await request(app).post('/admin/seasons').set(AUTH).send({});
  expect(res.status).toBe(200);
  expect(res.body.id).toBeDefined();
  expect(res.body.status).toBe('pending');
  expect(res.body.season_length).toBe(100);
  expect(res.body.tick_interval_ms).toBe(60000);
  expect(typeof res.body.scoring_weights).toBe('object');
  expect(typeof res.body.starting_resources).toBe('object');
  // Districts and laws should have been created
  const districts = db.prepare('SELECT * FROM districts WHERE season_id = ?').all(res.body.id);
  expect(districts.length).toBe(24);
});

test('POST /admin/seasons stores custom params', async () => {
  const res = await request(app).post('/admin/seasons').set(AUTH).send({
    season_length: 50,
    tick_interval_ms: 5000,
    scoring: { credits: 2, energy: 3, workforce: 1, intelligence: 1, influence: 1, political_power: 1, districts: 5 },
    starting_resources: { credits: 500, energy: 250 },
  });
  expect(res.status).toBe(200);
  const row = db.prepare('SELECT * FROM seasons WHERE id = ?').get(res.body.id);
  expect(row.season_length).toBe(50);
  expect(row.tick_interval_ms).toBe(5000);
  const sw = JSON.parse(row.scoring_weights);
  expect(sw.credits).toBe(2);
  const sr = JSON.parse(row.starting_resources);
  expect(sr.credits).toBe(500);
  expect(sr.energy).toBe(250);
});

test('POST /admin/seasons with starting_resources — subsequent /register uses those values', async () => {
  await request(app).post('/admin/seasons').set(AUTH).send({
    starting_resources: { credits: 888 },
  });
  // Register a corp (season is pending — registration open)
  const regRes = await request(app).post('/register').send({ name: 'TestCorp' });
  expect(regRes.status).toBe(200);
  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(regRes.body.agentId);
  expect(corp.credits).toBe(888);
  expect(corp.energy).toBe(8); // schema default
});

test('POST /admin/seasons without starting_resources — register uses schema defaults', async () => {
  await request(app).post('/admin/seasons').set(AUTH).send({});
  const regRes = await request(app).post('/register').send({ name: 'DefaultCorp' });
  expect(regRes.status).toBe(200);
  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(regRes.body.agentId);
  expect(corp.credits).toBe(10);
  expect(corp.workforce).toBe(6);
});

// --- Lifecycle transitions ---

test('POST /admin/seasons/:id/start transitions pending → active', async () => {
  const seasonId = createSeason(db); createDistrictMap(db, seasonId);
  const res = await request(app).post(`/admin/seasons/${seasonId}/start`).set(AUTH);
  expect(res.status).toBe(200);
  expect(db.prepare('SELECT status FROM seasons WHERE id = ?').get(seasonId).status).toBe('active');
});

test('POST /admin/seasons/:id/start returns 409 if not pending', async () => {
  const seasonId = createSeason(db); createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);
  const res = await request(app).post(`/admin/seasons/${seasonId}/start`).set(AUTH);
  expect(res.status).toBe(409);
});

test('POST /admin/seasons/:id/pause transitions active → paused', async () => {
  const seasonId = createSeason(db); createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);
  const res = await request(app).post(`/admin/seasons/${seasonId}/pause`).set(AUTH);
  expect(res.status).toBe(200);
  expect(db.prepare('SELECT status FROM seasons WHERE id = ?').get(seasonId).status).toBe('paused');
});

test('POST /admin/seasons/:id/pause returns 409 if not active', async () => {
  const seasonId = createSeason(db); createDistrictMap(db, seasonId);
  const res = await request(app).post(`/admin/seasons/${seasonId}/pause`).set(AUTH);
  expect(res.status).toBe(409);
});

test('POST /admin/seasons/:id/resume transitions paused → active', async () => {
  const seasonId = createSeason(db); createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'paused' WHERE id = ?").run(seasonId);
  const res = await request(app).post(`/admin/seasons/${seasonId}/resume`).set(AUTH);
  expect(res.status).toBe(200);
  expect(db.prepare('SELECT status FROM seasons WHERE id = ?').get(seasonId).status).toBe('active');
});

test('POST /admin/seasons/:id/resume returns 409 if not paused', async () => {
  const seasonId = createSeason(db); createDistrictMap(db, seasonId);
  const res = await request(app).post(`/admin/seasons/${seasonId}/resume`).set(AUTH);
  expect(res.status).toBe(409);
});

test('POST /admin/seasons/:id/end transitions active → ended', async () => {
  const seasonId = createSeason(db); createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);
  const res = await request(app).post(`/admin/seasons/${seasonId}/end`).set(AUTH);
  expect(res.status).toBe(200);
  expect(db.prepare('SELECT status FROM seasons WHERE id = ?').get(seasonId).status).toBe('ended');
});

test('POST /admin/seasons/:id/end transitions paused → ended', async () => {
  const seasonId = createSeason(db); createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'paused' WHERE id = ?").run(seasonId);
  const res = await request(app).post(`/admin/seasons/${seasonId}/end`).set(AUTH);
  expect(res.status).toBe(200);
  expect(db.prepare('SELECT status FROM seasons WHERE id = ?').get(seasonId).status).toBe('ended');
});

test('POST /admin/seasons/:id/end returns 409 if pending', async () => {
  const seasonId = createSeason(db); createDistrictMap(db, seasonId);
  const res = await request(app).post(`/admin/seasons/${seasonId}/end`).set(AUTH);
  expect(res.status).toBe(409);
});

// --- Manual tick ---

test('POST /admin/seasons/:id/tick increments tick_count on active season', async () => {
  const seasonId = createSeason(db); createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);
  const res = await request(app).post(`/admin/seasons/${seasonId}/tick`).set(AUTH);
  expect(res.status).toBe(200);
  const row = db.prepare('SELECT tick_count FROM seasons WHERE id = ?').get(seasonId);
  expect(row.tick_count).toBe(1);
});

test('POST /admin/seasons/:id/tick returns 409 if season not active', async () => {
  const seasonId = createSeason(db); createDistrictMap(db, seasonId);
  const res = await request(app).post(`/admin/seasons/${seasonId}/tick`).set(AUTH);
  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/not active/i);
});

test('POST /admin/seasons/:id/tick returns 409 if is_ticking = 1', async () => {
  const seasonId = createSeason(db); createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active', is_ticking = 1 WHERE id = ?").run(seasonId);
  const res = await request(app).post(`/admin/seasons/${seasonId}/tick`).set(AUTH);
  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/in progress/i);
});
