// tests/api/action.test.js
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

test('POST /action/:agentId requires auth', async () => {
  const res = await request(app).post(`/action/${corpId}`).send({ response: 'do something' });
  expect(res.status).toBe(401);
});

test('POST /action/:agentId stores NL response as pending action', async () => {
  const res = await request(app)
    .post(`/action/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`)
    .send({ response: 'attack the northgate district' });

  expect(res.status).toBe(200);
  expect(res.body.received).toBe(true);

  const action = db.prepare('SELECT * FROM pending_actions WHERE corp_id = ?').get(corpId);
  expect(action.raw_response).toBe('attack the northgate district');
  expect(action.status).toBe('pending');
});

test('POST /action/:agentId accepts direct JSON actions', async () => {
  const res = await request(app)
    .post(`/action/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`)
    .send({
      actions: {
        primaryAction: { type: 'fortify', targetDistrictId: 'some-id' },
        freeActions: [],
      }
    });

  expect(res.status).toBe(200);
  const action = db.prepare('SELECT * FROM pending_actions WHERE corp_id = ?').get(corpId);
  expect(JSON.parse(action.parsed_actions).primaryAction.type).toBe('fortify');
});

test('POST /action/:agentId overwrites previous submission in same tick (UNIQUE constraint)', async () => {
  const currentTick = db.prepare('SELECT tick_count FROM seasons WHERE id = ?').get(seasonId).tick_count;

  await request(app)
    .post(`/action/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`)
    .send({ response: 'first action' });

  await request(app)
    .post(`/action/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`)
    .send({ response: 'second action' });

  const actions = db.prepare(
    'SELECT * FROM pending_actions WHERE corp_id = ? AND tick = ?'
  ).all(corpId, currentTick);
  expect(actions).toHaveLength(1);
  expect(actions[0].raw_response).toBe('second action');
});

test('POST /action/:agentId returns 400 when neither response nor actions provided', async () => {
  const res = await request(app)
    .post(`/action/${corpId}`)
    .set('Authorization', `Bearer ${apiKey}`)
    .send({});
  expect(res.status).toBe(400);
});
