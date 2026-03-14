// tests/api/admin/corps.test.js
const request = require('supertest');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const { initDb } = require('../../../src/db/schema');
const { createServer } = require('../../../src/api/server');
const { createSeason, createDistrictMap } = require('../../../src/game/world');

const ADMIN_KEY = 'test-key';
const AUTH = { Authorization: `Bearer ${ADMIN_KEY}` };

let app, db, seasonId, corpId;

beforeEach(() => {
  process.env.ADMIN_KEY = ADMIN_KEY;
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);

  corpId = crypto.randomUUID();
  db.prepare(`INSERT INTO corporations (id, season_id, name, description, api_key, credits, energy, workforce, intelligence, influence, political_power)
    VALUES (?, ?, 'TestCorp', '', 'key1', 100, 80, 60, 40, 20, 10)`)
    .run(corpId, seasonId);

  ({ app } = createServer(db));
});

afterEach(() => {
  delete process.env.ADMIN_KEY;
  db.close();
});

test('GET /admin/corps returns corps with all resource columns', async () => {
  const res = await request(app).get('/admin/corps').set(AUTH);
  expect(res.status).toBe(200);
  expect(res.body.length).toBe(1);
  const c = res.body[0];
  expect(c.id).toBe(corpId);
  expect(c.credits).toBe(100);
  expect(c.energy).toBe(80);
  expect(c.workforce).toBe(60);
  expect(c.intelligence).toBe(40);
  expect(c.influence).toBe(20);
  expect(c.political_power).toBe(10);
  expect(c.reputation).toBeDefined();
  expect(c.districtCount).toBeDefined();
});

test('GET /admin/corps returns empty array when no active/paused season', async () => {
  db.prepare("UPDATE seasons SET status = 'ended' WHERE id = ?").run(seasonId);
  const res = await request(app).get('/admin/corps').set(AUTH);
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
});

test('PATCH /admin/corps/:id applies positive delta', async () => {
  const res = await request(app).patch(`/admin/corps/${corpId}`).set(AUTH).send({ credits: 50 });
  expect(res.status).toBe(200);
  const corp = db.prepare('SELECT credits FROM corporations WHERE id = ?').get(corpId);
  expect(corp.credits).toBe(150);
});

test('PATCH /admin/corps/:id clamps negative delta at 0', async () => {
  const res = await request(app).patch(`/admin/corps/${corpId}`).set(AUTH).send({ credits: -999 });
  expect(res.status).toBe(200);
  const corp = db.prepare('SELECT credits FROM corporations WHERE id = ?').get(corpId);
  expect(corp.credits).toBe(0);
});

test('PATCH /admin/corps/:id returns 404 for unknown corp', async () => {
  const res = await request(app).patch('/admin/corps/no-such-id').set(AUTH).send({ credits: 1 });
  expect(res.status).toBe(404);
});

test('DELETE /admin/corps/:id removes corp and clears owned districts', async () => {
  const districtId = db.prepare('SELECT id FROM districts WHERE season_id = ?').get(seasonId).id;
  db.prepare('UPDATE districts SET owner_id = ? WHERE id = ?').run(corpId, districtId);

  const res = await request(app).delete(`/admin/corps/${corpId}`).set(AUTH);
  expect(res.status).toBe(200);
  expect(db.prepare('SELECT * FROM corporations WHERE id = ?').get(corpId)).toBeUndefined();
  expect(db.prepare('SELECT owner_id FROM districts WHERE id = ?').get(districtId).owner_id).toBeNull();
});

test('DELETE /admin/corps/:id cleans up pending_actions and briefings', async () => {
  db.prepare("INSERT INTO pending_actions (id, corp_id, tick) VALUES (?, ?, 1)").run(crypto.randomUUID(), corpId);
  db.prepare("INSERT INTO briefings (id, corp_id, tick, payload) VALUES (?, ?, 1, '{}')").run(crypto.randomUUID(), corpId);

  await request(app).delete(`/admin/corps/${corpId}`).set(AUTH);

  expect(db.prepare('SELECT * FROM pending_actions WHERE corp_id = ?').get(corpId)).toBeUndefined();
  expect(db.prepare('SELECT * FROM briefings WHERE corp_id = ?').get(corpId)).toBeUndefined();
});

test('DELETE /admin/corps/:id returns 404 for unknown corp', async () => {
  const res = await request(app).delete('/admin/corps/no-such-id').set(AUTH);
  expect(res.status).toBe(404);
});

test('DELETE /admin/corps/:id cleans up messages and lobby_votes', async () => {
  // Insert a message from the corp
  db.prepare("INSERT INTO messages (id, from_corp_id, to_corp_id, text, delivered_tick) VALUES (?, ?, ?, 'hello', 1)")
    .run(crypto.randomUUID(), corpId, corpId);

  // Insert a phase, law, and lobby_vote referencing corp
  const phaseId = crypto.randomUUID();
  db.prepare("INSERT INTO phases (id, season_id, phase_number, start_tick) VALUES (?, ?, 1, 1)")
    .run(phaseId, seasonId);
  const lawId = crypto.randomUUID();
  db.prepare("INSERT INTO laws (id, season_id, name, effect) VALUES (?, ?, 'TestLaw', '{}')")
    .run(lawId, seasonId);
  db.prepare("INSERT INTO lobby_votes (id, phase_id, corp_id, law_id, credits) VALUES (?, ?, ?, ?, 10)")
    .run(crypto.randomUUID(), phaseId, corpId, lawId);

  await request(app).delete(`/admin/corps/${corpId}`).set(AUTH);

  expect(db.prepare('SELECT * FROM messages WHERE from_corp_id = ?').get(corpId)).toBeUndefined();
  expect(db.prepare('SELECT * FROM lobby_votes WHERE corp_id = ?').get(corpId)).toBeUndefined();
});

test('PATCH /admin/corps/:id returns 400 when no valid fields provided', async () => {
  const res = await request(app).patch(`/admin/corps/${corpId}`).set(AUTH).send({ bogus: 999 });
  expect(res.status).toBe(400);
});

test('PATCH /admin/corps/:id returns 400 for non-numeric delta', async () => {
  const res = await request(app).patch(`/admin/corps/${corpId}`).set(AUTH).send({ credits: 'abc' });
  expect(res.status).toBe(400);
});
