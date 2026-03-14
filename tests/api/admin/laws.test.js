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
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);
  ({ app } = createServer(db));
});

afterEach(() => {
  delete process.env.ADMIN_KEY;
  db.close();
});

test('POST /admin/laws creates law with is_active = 1', async () => {
  const res = await request(app).post('/admin/laws').set(AUTH).send({ name: 'Test Act', effect: 'test_effect' });
  expect(res.status).toBe(200);
  const law = db.prepare("SELECT * FROM laws WHERE name = 'Test Act' AND season_id = ?").get(seasonId);
  expect(law.is_active).toBe(1);
});

test('POST /admin/laws deactivates previous active law', async () => {
  const prevId = crypto.randomUUID();
  db.prepare("INSERT INTO laws (id, season_id, name, effect, is_active) VALUES (?, ?, 'Old Act', 'old', 1)").run(prevId, seasonId);

  await request(app).post('/admin/laws').set(AUTH).send({ name: 'New Act', effect: 'new_effect' });

  expect(db.prepare('SELECT is_active FROM laws WHERE id = ?').get(prevId).is_active).toBe(0);
  const newLaw = db.prepare("SELECT * FROM laws WHERE name = 'New Act'").get();
  expect(newLaw.is_active).toBe(1);
});

test('POST /admin/laws returns 400 when name or effect is missing', async () => {
  expect((await request(app).post('/admin/laws').set(AUTH).send({ name: 'Only Name' })).status).toBe(400);
  expect((await request(app).post('/admin/laws').set(AUTH).send({ effect: 'only_effect' })).status).toBe(400);
});

test('POST /admin/laws returns 409 for duplicate law name in same season', async () => {
  await request(app).post('/admin/laws').set(AUTH).send({ name: 'Dupe Act', effect: 'x' });
  const res = await request(app).post('/admin/laws').set(AUTH).send({ name: 'Dupe Act', effect: 'y' });
  expect(res.status).toBe(409);
});

test('POST /admin/laws returns 404 when no active/paused season', async () => {
  db.prepare("UPDATE seasons SET status = 'ended' WHERE id = ?").run(seasonId);
  const res = await request(app).post('/admin/laws').set(AUTH).send({ name: 'Act', effect: 'e' });
  expect(res.status).toBe(404);
});

test('DELETE /admin/laws/:id sets is_active = 0', async () => {
  const lawId = crypto.randomUUID();
  db.prepare("INSERT INTO laws (id, season_id, name, effect, is_active) VALUES (?, ?, 'Act', 'eff', 1)").run(lawId, seasonId);

  const res = await request(app).delete(`/admin/laws/${lawId}`).set(AUTH);
  expect(res.status).toBe(200);
  expect(db.prepare('SELECT is_active FROM laws WHERE id = ?').get(lawId).is_active).toBe(0);
});

test('DELETE /admin/laws/:id returns 404 for unknown law', async () => {
  const res = await request(app).delete('/admin/laws/no-such-id').set(AUTH);
  expect(res.status).toBe(404);
});

test('DELETE /admin/laws/:id returns 404 when no active/paused season', async () => {
  db.prepare("UPDATE seasons SET status = 'ended' WHERE id = ?").run(seasonId);
  const res = await request(app).delete('/admin/laws/any-id').set(AUTH);
  expect(res.status).toBe(404);
});
