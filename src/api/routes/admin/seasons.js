// src/api/routes/admin/seasons.js
const crypto = require('crypto');
const express = require('express');
const { createLaws, createDistrictMap } = require('../../../game/world');
const { runTickNow } = require('../../../game/tick');

const SEASON_DEFAULTS = {
  season_length: 100,
  tick_interval_ms: 60000,
  scoring: { credits: 1, energy: 1, workforce: 1, intelligence: 1, influence: 1, political_power: 1, districts: 10 },
  starting_resources: {},
};

module.exports = function adminSeasonsRouter(db) {
  const router = express.Router();

  // Create season
  router.post('/', (req, res) => {
    const {
      season_length = SEASON_DEFAULTS.season_length,
      tick_interval_ms = SEASON_DEFAULTS.tick_interval_ms,
      scoring = SEASON_DEFAULTS.scoring,
      starting_resources = SEASON_DEFAULTS.starting_resources,
    } = req.body;

    const id = crypto.randomUUID();
    const scoring_weights = JSON.stringify({ ...SEASON_DEFAULTS.scoring, ...scoring });
    const sr = JSON.stringify(starting_resources);

    db.prepare(`
      INSERT INTO seasons (id, status, tick_interval_ms, season_length, scoring_weights, starting_resources)
      VALUES (?, 'pending', ?, ?, ?, ?)
    `).run(id, tick_interval_ms, season_length, scoring_weights, sr);

    createLaws(db, id);
    createDistrictMap(db, id);

    const row = db.prepare('SELECT * FROM seasons WHERE id = ?').get(id);
    res.json({
      id: row.id,
      status: row.status,
      season_length: row.season_length,
      tick_interval_ms: row.tick_interval_ms,
      scoring_weights: JSON.parse(row.scoring_weights),
      starting_resources: JSON.parse(row.starting_resources),
    });
  });

  // Lifecycle helpers
  function transition(req, res, requiredStatus, newStatus, errorMsg) {
    const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
    if (!season) return res.status(404).json({ error: 'Season not found' });
    const valid = Array.isArray(requiredStatus)
      ? requiredStatus.includes(season.status)
      : season.status === requiredStatus;
    if (!valid) return res.status(409).json({ error: errorMsg });
    db.prepare('UPDATE seasons SET status = ? WHERE id = ?').run(newStatus, season.id);
    res.json({ ok: true });
  }

  router.post('/:id/start',  (req, res) => transition(req, res, 'pending', 'active', 'Season is not in pending status'));
  router.post('/:id/pause',  (req, res) => transition(req, res, 'active', 'paused', 'Season is not active'));
  router.post('/:id/resume', (req, res) => transition(req, res, 'paused', 'active', 'Season is not paused'));
  router.post('/:id/end',    (req, res) => transition(req, res, ['active', 'paused'], 'ended', 'Season is not active or paused'));

  // Manual tick
  router.post('/:id/tick', async (req, res) => {
    const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
    if (!season) return res.status(404).json({ error: 'Season not found' });
    if (season.status !== 'active') return res.status(409).json({ error: 'Season is not active' });
    if (season.is_ticking) return res.status(409).json({ error: 'Tick already in progress' });
    try {
      await runTickNow(db, season.id);
    } catch (err) {
      console.error('[admin tick] runTick failed:', err);
      return res.status(500).json({ error: 'Tick failed' });
    }
    res.json({ ok: true });
  });

  return router;
};
