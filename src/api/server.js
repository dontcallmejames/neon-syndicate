// src/api/server.js
const express = require('express');
const { getDb } = require('../db/index');
const { requireAuth } = require('./auth');
const registerRoute = require('./routes/register');
const briefingRoute = require('./routes/briefing');
const actionRoute = require('./routes/action');

function createServer(db) {
  const conn = db || getDb();
  const app = express();
  app.use(express.json());

  app.post('/register', registerRoute(conn));
  app.get('/briefing/:agentId', requireAuth(conn), briefingRoute(conn));
  app.post('/action/:agentId', requireAuth(conn), actionRoute(conn));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  return app;
}

module.exports = { createServer };
