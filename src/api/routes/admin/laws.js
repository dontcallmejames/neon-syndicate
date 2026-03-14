const crypto = require('crypto');
const express = require('express');

module.exports = function adminLawsRouter(db) {
  const router = express.Router();

  function getActiveSeason() {
    return db.prepare("SELECT id FROM seasons WHERE status IN ('active', 'paused') ORDER BY created_at DESC LIMIT 1").get();
  }

  router.post('/', (req, res) => {
    const season = getActiveSeason();
    if (!season) return res.status(404).json({ error: 'No active season' });

    const { name, effect } = req.body;
    if (!name || !effect) return res.status(400).json({ error: 'name and effect are required' });

    try {
      db.transaction(() => {
        // Deactivate previous active law
        db.prepare("UPDATE laws SET is_active = 0 WHERE season_id = ? AND is_active = 1").run(season.id);
        db.prepare("INSERT INTO laws (id, season_id, name, effect, is_active, active_since) VALUES (?, ?, ?, ?, 1, ?)")
          .run(crypto.randomUUID(), season.id, name, effect, Math.floor(Date.now() / 1000));
      })();
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'A law with that name already exists in this season' });
      }
      throw err;
    }

    res.json({ ok: true });
  });

  router.delete('/:id', (req, res) => {
    const season = getActiveSeason();
    if (!season) return res.status(404).json({ error: 'No active season' });

    const law = db.prepare('SELECT id FROM laws WHERE id = ? AND season_id = ?').get(req.params.id, season.id);
    if (!law) return res.status(404).json({ error: 'Law not found' });

    db.prepare('UPDATE laws SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  return router;
};
