// src/api/server.js
const http = require('http');
const path = require('path');
const express = require('express');
const { getDb } = require('../db/index');
const { requireAuth } = require('./auth');
const registerRoute = require('./routes/register');
const briefingRoute = require('./routes/briefing');
const actionRoute = require('./routes/action');
const worldRoute = require('./routes/world');
const { createWsServer } = require('./ws');
const adminAuth = require('./middleware/adminAuth');
const adminState = require('./routes/admin/state');
const adminSeasons = require('./routes/admin/seasons');
const adminCorps = require('./routes/admin/corps');
const adminDistricts = require('./routes/admin/districts');
const adminLaws = require('./routes/admin/laws');

function createServer(db) {
  const conn = db || getDb();
  const app = express();
  app.use(express.json());

  // API routes first — prevents public/ files from shadowing API paths
  app.post('/register', registerRoute(conn));
  app.get('/briefing/:agentId', requireAuth(conn), briefingRoute(conn));
  app.post('/action/:agentId', requireAuth(conn), actionRoute(conn));
  app.get('/world', worldRoute(conn));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Admin routes — protected by Bearer token, before static so /admin/* can't be shadowed
  app.use('/admin', adminAuth);
  app.get('/admin/state', adminState(conn));
  app.use('/admin/seasons', adminSeasons(conn));
  app.use('/admin/corps', adminCorps(conn));
  app.use('/admin/districts', adminDistricts(conn));
  app.use('/admin/laws', adminLaws(conn));

  // Static file serving after routes
  // public/ created in Task 7 — no-op until then
  app.use(express.static(path.join(__dirname, '../../public')));

  const httpServer = http.createServer(app);
  createWsServer(httpServer);

  return { app, httpServer };
}

module.exports = { createServer };
