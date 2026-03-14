// tests/api/register.test.js
const request = require('supertest');
const Database = require('better-sqlite3');
const { initDb } = require('../../src/db/schema');
const { createSeason, createDistrictMap } = require('../../src/game/world');
const { createServer } = require('../../src/api/server');

let app, db, seasonId;

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  // Season starts as 'pending' by default — registration is open
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  ({ app } = createServer(db));
});
afterEach(() => db.close());

test('POST /register succeeds when season is pending', async () => {
  const res = await request(app)
    .post('/register')
    .send({ name: 'TestCorp', description: 'A test corp' });

  expect(res.status).toBe(200);
  expect(res.body.agentId).toBeDefined();
  expect(res.body.apiKey).toBeDefined();
  expect(res.body.startingDistrictId).toBeDefined();
});

test('POST /register assigns a non-Government Quarter starting district', async () => {
  const res = await request(app)
    .post('/register')
    .send({ name: 'TestCorp' });

  const district = db.prepare('SELECT * FROM districts WHERE id = ?').get(res.body.startingDistrictId);
  expect(district.type).not.toBe('government_quarter');
  expect(district.owner_id).toBe(res.body.agentId);
});

test('POST /register starting districts are not adjacent to each other', async () => {
  const res1 = await request(app).post('/register').send({ name: 'Corp1' });
  const res2 = await request(app).post('/register').send({ name: 'Corp2' });

  expect(res1.status).toBe(200);
  expect(res2.status).toBe(200);

  const d1 = db.prepare('SELECT adjacent_ids FROM districts WHERE id = ?').get(res1.body.startingDistrictId);
  const d1Neighbors = JSON.parse(d1.adjacent_ids);
  expect(d1Neighbors).not.toContain(res2.body.startingDistrictId);
});

test('POST /register returns 403 when season is active (registration closed)', async () => {
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);

  const res = await request(app)
    .post('/register')
    .send({ name: 'LateCorp' });

  expect(res.status).toBe(403);
  expect(res.body.error).toMatch(/registration is closed/i);
});

test('POST /register returns 403 when no season exists', async () => {
  db.prepare('DELETE FROM districts').run();
  db.prepare('DELETE FROM seasons').run();
  const res = await request(app).post('/register').send({ name: 'TestCorp' });
  expect(res.status).toBe(403);
});

test('POST /register returns 400 when name is missing', async () => {
  const res = await request(app).post('/register').send({});
  expect(res.status).toBe(400);
});

test('POST /register applies custom starting_resources from season', async () => {
  db.prepare('UPDATE seasons SET starting_resources = ? WHERE id = ?')
    .run(JSON.stringify({ credits: 999, energy: 777 }), seasonId);

  const res = await request(app).post('/register').send({ name: 'ResourceCorp' });
  expect(res.status).toBe(200);

  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(res.body.agentId);
  expect(corp.credits).toBe(999);
  expect(corp.energy).toBe(777);
  expect(corp.workforce).toBe(6); // schema default — not overridden
});

test('POST /register uses schema defaults when starting_resources is empty', async () => {
  const res = await request(app).post('/register').send({ name: 'DefaultCorp' });
  expect(res.status).toBe(200);

  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(res.body.agentId);
  expect(corp.credits).toBe(10);
  expect(corp.energy).toBe(8);
  expect(corp.workforce).toBe(6);
  expect(corp.intelligence).toBe(4);
  expect(corp.influence).toBe(0);
  expect(corp.political_power).toBe(0);
});
