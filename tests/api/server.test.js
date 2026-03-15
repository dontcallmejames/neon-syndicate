// tests/api/server.test.js
const request = require('supertest');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { initDb } = require('../../src/db/schema');
const { createServer } = require('../../src/api/server');

let app, db;

beforeEach(() => {
  db = new Database(':memory:');
  initDb(db);
  ({ app } = createServer(db));

  // Create placeholder HTML files if they don't exist
  const publicDir = path.join(__dirname, '../../public');
  if (!fs.existsSync(path.join(publicDir, 'play.html'))) {
    fs.writeFileSync(path.join(publicDir, 'play.html'), '<html><body>play</body></html>');
  }
  if (!fs.existsSync(path.join(publicDir, 'game.html'))) {
    fs.writeFileSync(path.join(publicDir, 'game.html'), '<html><body>game</body></html>');
  }
});
afterEach(() => db.close());

test('GET /play returns 200', async () => {
  const res = await request(app).get('/play');
  expect(res.status).toBe(200);
});

test('GET /game returns 200', async () => {
  const res = await request(app).get('/game');
  expect(res.status).toBe(200);
});

test('GET /health still works', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
});
