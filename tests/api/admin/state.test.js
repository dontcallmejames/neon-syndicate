// tests/api/admin/state.test.js
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

test('GET /admin/state returns 401 without auth', async () => {
  const res = await request(app).get('/admin/state');
  expect(res.status).toBe(401);
});

test('GET /admin/state returns 503 when ADMIN_KEY not configured', async () => {
  delete process.env.ADMIN_KEY;
  const res = await request(app).get('/admin/state').set(AUTH);
  expect(res.status).toBe(503);
});

test('GET /admin/state returns null season and empty arrays when no seasons exist', async () => {
  const res = await request(app).get('/admin/state').set(AUTH);
  expect(res.status).toBe(200);
  expect(res.body.season).toBeNull();
  expect(res.body.corps).toEqual([]);
  expect(res.body.districts).toEqual([]);
  expect(res.body.activeLaw).toBeNull();
  expect(res.body.recentEvents).toEqual([]);
});

test('GET /admin/state returns active season with corps and districts', async () => {
  const seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);

  const res = await request(app).get('/admin/state').set(AUTH);
  expect(res.status).toBe(200);
  expect(res.body.season.id).toBe(seasonId);
  expect(res.body.season.status).toBe('active');
  expect(typeof res.body.season.scoring_weights).toBe('object');
  expect(typeof res.body.season.starting_resources).toBe('object');
  expect(Array.isArray(res.body.districts)).toBe(true);
  expect(res.body.districts.length).toBeGreaterThan(0);
});

test('GET /admin/state prefers non-ended season over ended', async () => {
  const endedId = createSeason(db);
  createDistrictMap(db, endedId);
  db.prepare("UPDATE seasons SET status = 'ended' WHERE id = ?").run(endedId);

  const activeId = createSeason(db);
  createDistrictMap(db, activeId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(activeId);

  const res = await request(app).get('/admin/state').set(AUTH);
  expect(res.body.season.id).toBe(activeId);
});

test('GET /admin/state recentEvents is limited to 10, ordered by tick desc', async () => {
  const seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);

  const crypto = require('crypto');
  for (let i = 1; i <= 12; i++) {
    db.prepare("INSERT INTO events (id, season_id, tick, type, narrative) VALUES (?, ?, ?, 'headline', ?)")
      .run(crypto.randomUUID(), seasonId, i, `Headline ${i}`);
  }

  const res = await request(app).get('/admin/state').set(AUTH);
  expect(res.body.recentEvents.length).toBe(10);
  expect(res.body.recentEvents[0].tick).toBe(12); // highest tick first
});
