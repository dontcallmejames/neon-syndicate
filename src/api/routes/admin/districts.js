const express = require('express');

module.exports = function adminDistrictsRouter(db) {
  const router = express.Router();

  router.patch('/:id', (req, res) => {
    const district = db.prepare('SELECT * FROM districts WHERE id = ?').get(req.params.id);
    if (!district) return res.status(404).json({ error: 'District not found' });

    const { ownerId } = req.body;

    if (ownerId !== null && ownerId !== undefined) {
      const corp = db.prepare('SELECT id FROM corporations WHERE id = ? AND season_id = ?').get(ownerId, district.season_id);
      if (!corp) return res.status(400).json({ error: 'Invalid ownerId' });
    }

    db.prepare('UPDATE districts SET owner_id = ? WHERE id = ?').run(ownerId ?? null, district.id);
    res.json({ ok: true });
  });

  return router;
};
