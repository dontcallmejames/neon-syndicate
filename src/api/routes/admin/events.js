const crypto = require('crypto');
const express = require('express');

const VALID_TYPES = ['headline', 'action', 'system'];

module.exports = function adminEventsRouter(db) {
  const router = express.Router();

  function getActiveSeason() {
    return db.prepare("SELECT id, tick_count FROM seasons WHERE status IN ('active', 'paused') ORDER BY created_at DESC LIMIT 1").get();
  }

  router.post('/', (req, res) => {
    const season = getActiveSeason();
    if (!season) return res.status(404).json({ error: 'No active season' });

    const { type, narrative } = req.body;
    if (!type || !narrative) return res.status(400).json({ error: 'type and narrative are required' });
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });

    db.prepare(`
      INSERT INTO events (id, season_id, tick, type, narrative)
      VALUES (?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), season.id, season.tick_count, type, narrative);

    res.json({ ok: true });
  });

  router.get('/', (req, res) => {
    const season = getActiveSeason();
    if (!season) return res.status(404).json({ error: 'No active season' });

    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const events = db.prepare(`
      SELECT id, type, tick, narrative FROM events
      WHERE season_id = ?
      ORDER BY tick DESC
      LIMIT ? OFFSET ?
    `).all(season.id, limit, offset);

    res.json(events);
  });

  return router;
};
