const request = require('supertest');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const { initDb } = require('../../../src/db/schema');
const { createServer } = require('../../../src/api/server');
const { createSeason, createDistrictMap } = require('../../../src/game/world');

const ADMIN_KEY = 'test-key';
const AUTH = { Authorization: `Bearer ${ADMIN_KEY}` };

let app, db, seasonId;

beforeEach(() => {
  process.env.ADMIN_KEY = ADMIN_KEY;
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active', tick_count = 5 WHERE id = ?").run(seasonId);
  ({ app } = createServer(db));
});

afterEach(() => {
  delete process.env.ADMIN_KEY;
  db.close();
});

test('POST /admin/events stores event with correct season_id, tick, type, narrative', async () => {
  const res = await request(app).post('/admin/events').set(AUTH)
    .send({ type: 'headline', narrative: 'Test headline' });
  expect(res.status).toBe(200);

  const event = db.prepare("SELECT * FROM events WHERE narrative = 'Test headline'").get();
  expect(event).toBeDefined();
  expect(event.season_id).toBe(seasonId);
  expect(event.tick).toBe(5); // current tick_count
  expect(event.type).toBe('headline');
});

test('POST /admin/events returns 400 for invalid type', async () => {
  const res = await request(app).post('/admin/events').set(AUTH)
    .send({ type: 'invalid', narrative: 'Bad type' });
  expect(res.status).toBe(400);
});

test('POST /admin/events returns 400 for missing fields', async () => {
  expect((await request(app).post('/admin/events').set(AUTH).send({ type: 'headline' })).status).toBe(400);
  expect((await request(app).post('/admin/events').set(AUTH).send({ narrative: 'hi' })).status).toBe(400);
});

test('POST /admin/events returns 404 when no active/paused season', async () => {
  db.prepare("UPDATE seasons SET status = 'ended' WHERE id = ?").run(seasonId);
  const res = await request(app).post('/admin/events').set(AUTH).send({ type: 'headline', narrative: 'x' });
  expect(res.status).toBe(404);
});

test('GET /admin/events returns events in descending tick order', async () => {
  for (let tick = 1; tick <= 3; tick++) {
    db.prepare("INSERT INTO events (id, season_id, tick, type, narrative) VALUES (?, ?, ?, 'headline', ?)")
      .run(crypto.randomUUID(), seasonId, tick, `Tick ${tick}`);
  }
  const res = await request(app).get('/admin/events').set(AUTH);
  expect(res.status).toBe(200);
  expect(res.body[0].tick).toBe(3);
  expect(res.body[1].tick).toBe(2);
  expect(res.body[2].tick).toBe(1);
});

test('GET /admin/events paginates with limit and offset', async () => {
  for (let i = 1; i <= 5; i++) {
    db.prepare("INSERT INTO events (id, season_id, tick, type, narrative) VALUES (?, ?, ?, 'headline', ?)")
      .run(crypto.randomUUID(), seasonId, i, `E${i}`);
  }
  const page1 = await request(app).get('/admin/events?limit=2&offset=0').set(AUTH);
  expect(page1.body.length).toBe(2);
  expect(page1.body[0].tick).toBe(5);

  const page2 = await request(app).get('/admin/events?limit=2&offset=2').set(AUTH);
  expect(page2.body.length).toBe(2);
  expect(page2.body[0].tick).toBe(3);
});

test('GET /admin/events returns 404 when no active/paused season', async () => {
  db.prepare("UPDATE seasons SET status = 'ended' WHERE id = ?").run(seasonId);
  const res = await request(app).get('/admin/events').set(AUTH);
  expect(res.status).toBe(404);
});
