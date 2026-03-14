const request = require('supertest');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const { initDb } = require('../../../src/db/schema');
const { createServer } = require('../../../src/api/server');
const { createSeason, createDistrictMap } = require('../../../src/game/world');

const ADMIN_KEY = 'test-key';
const AUTH = { Authorization: `Bearer ${ADMIN_KEY}` };

let app, db, seasonId, corpId, districtId;

beforeEach(() => {
  process.env.ADMIN_KEY = ADMIN_KEY;
  db = new Database(':memory:');
  initDb(db);
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);

  corpId = crypto.randomUUID();
  db.prepare("INSERT INTO corporations (id, season_id, name, description, api_key) VALUES (?, ?, 'Corp', '', 'k1')")
    .run(corpId, seasonId);

  districtId = db.prepare('SELECT id FROM districts WHERE season_id = ? LIMIT 1').get(seasonId).id;
  ({ app } = createServer(db));
});

afterEach(() => {
  delete process.env.ADMIN_KEY;
  db.close();
});

test('PATCH /admin/districts/:id assigns owner to valid corp', async () => {
  const res = await request(app).patch(`/admin/districts/${districtId}`).set(AUTH).send({ ownerId: corpId });
  expect(res.status).toBe(200);
  expect(db.prepare('SELECT owner_id FROM districts WHERE id = ?').get(districtId).owner_id).toBe(corpId);
});

test('PATCH /admin/districts/:id with ownerId null unclaims district', async () => {
  db.prepare('UPDATE districts SET owner_id = ? WHERE id = ?').run(corpId, districtId);
  const res = await request(app).patch(`/admin/districts/${districtId}`).set(AUTH).send({ ownerId: null });
  expect(res.status).toBe(200);
  expect(db.prepare('SELECT owner_id FROM districts WHERE id = ?').get(districtId).owner_id).toBeNull();
});

test('PATCH /admin/districts/:id returns 400 for invalid ownerId', async () => {
  const res = await request(app).patch(`/admin/districts/${districtId}`).set(AUTH).send({ ownerId: 'nonexistent-corp' });
  expect(res.status).toBe(400);
});

test('PATCH /admin/districts/:id returns 404 for unknown district', async () => {
  const res = await request(app).patch('/admin/districts/no-such-id').set(AUTH).send({ ownerId: null });
  expect(res.status).toBe(404);
});
