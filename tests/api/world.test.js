// tests/api/world.test.js
const request = require('supertest');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const { initDb } = require('../../src/db/schema');
const { createSeason, createDistrictMap } = require('../../src/game/world');
const { createServer } = require('../../src/api/server');

function uuidv4() { return crypto.randomUUID(); }

let app, db, seasonId;

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  ({ app } = createServer(db));
});
afterEach(() => db.close());

test('GET /world with no active season returns empty state', async () => {
  const res = await request(app).get('/world');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    type: 'world_state',
    tick: 0,
    districts: [],
    corporations: [],
    alliances: [],
    activeLaw: null,
    headlines: [],
  });
});

test('GET /world with active season at tick 0 returns districts and corps', async () => {
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);
  const corpId = uuidv4();
  db.prepare("INSERT INTO corporations (id, season_id, name, api_key) VALUES (?, ?, 'TestCorp', ?)")
    .run(corpId, seasonId, uuidv4());

  const res = await request(app).get('/world');
  expect(res.status).toBe(200);
  expect(res.body.tick).toBe(0);
  expect(res.body.districts.length).toBeGreaterThan(0);
  expect(res.body.corporations.length).toBe(1);
  expect(res.body.corporations[0].name).toBe('TestCorp');
  expect(res.body.activeLaw).toBeNull();
  expect(res.body.headlines).toEqual([]);
});

test('GET /world districts include adjacentIds array', async () => {
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);

  const res = await request(app).get('/world');
  expect(res.body.districts.length).toBeGreaterThan(0);
  res.body.districts.forEach(d => {
    expect(Array.isArray(d.adjacentIds)).toBe(true);
  });
});

test('ownerName is null for unclaimed districts', async () => {
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);

  const res = await request(app).get('/world');
  const unclaimed = res.body.districts.filter(d => !d.ownerId);
  expect(unclaimed.length).toBeGreaterThan(0);
  unclaimed.forEach(d => expect(d.ownerName).toBeNull());
});

test('activeLaw is null when no law is active', async () => {
  seasonId = createSeason(db);
  createDistrictMap(db, seasonId);
  db.prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(seasonId);

  const res = await request(app).get('/world');
  expect(res.body.activeLaw).toBeNull();
});
