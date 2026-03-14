// src/api/routes/admin/corps.js
const express = require('express');

const RESOURCE_FIELDS = ['credits', 'energy', 'workforce', 'intelligence', 'influence', 'political_power', 'reputation'];

module.exports = function adminCorpsRouter(db) {
  const router = express.Router();

  function getActiveSeason() {
    return db.prepare("SELECT id FROM seasons WHERE status IN ('active', 'paused') ORDER BY created_at DESC LIMIT 1").get();
  }

  router.get('/', (req, res) => {
    const season = getActiveSeason();
    if (!season) return res.json([]);

    const corps = db.prepare(`
      SELECT c.id, c.name, c.credits, c.energy, c.workforce, c.intelligence,
             c.influence, c.political_power, c.reputation, COUNT(d.id) AS district_count
      FROM corporations c
      LEFT JOIN districts d ON d.owner_id = c.id AND d.season_id = c.season_id
      WHERE c.season_id = ?
      GROUP BY c.id
      ORDER BY c.rowid ASC
    `).all(season.id).map(c => ({
      id: c.id, name: c.name, credits: c.credits, energy: c.energy,
      workforce: c.workforce, intelligence: c.intelligence,
      influence: c.influence, political_power: c.political_power,
      reputation: c.reputation, districtCount: c.district_count,
    }));

    res.json(corps);
  });

  router.patch('/:id', (req, res) => {
    const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(req.params.id);
    if (!corp) return res.status(404).json({ error: 'Corporation not found' });

    const updates = [];
    const values = [];
    for (const field of RESOURCE_FIELDS) {
      if (req.body[field] !== undefined) {
        const delta = Number(req.body[field]);
        if (!Number.isFinite(delta)) {
          return res.status(400).json({ error: `Invalid value for field: ${field}` });
        }
        updates.push(`${field} = MAX(0, ${field} + ?)`);
        values.push(delta);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid resource fields provided' });
    }
    db.prepare(`UPDATE corporations SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values, req.params.id);

    res.json({ ok: true });
  });

  router.delete('/:id', (req, res) => {
    const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(req.params.id);
    if (!corp) return res.status(404).json({ error: 'Corporation not found' });

    db.transaction(() => {
      db.prepare('UPDATE districts SET owner_id = NULL WHERE owner_id = ?').run(corp.id);
      db.prepare('DELETE FROM pending_actions WHERE corp_id = ?').run(corp.id);
      db.prepare('DELETE FROM alliances WHERE corp_a_id = ? OR corp_b_id = ?').run(corp.id, corp.id);
      db.prepare('DELETE FROM embargoes WHERE corp_id = ? OR target_corp_id = ?').run(corp.id, corp.id);
      db.prepare('DELETE FROM briefings WHERE corp_id = ?').run(corp.id);
      db.prepare('DELETE FROM messages WHERE from_corp_id = ? OR to_corp_id = ?').run(corp.id, corp.id);
      db.prepare('DELETE FROM lobby_votes WHERE corp_id = ?').run(corp.id);
      db.prepare('DELETE FROM corporations WHERE id = ?').run(corp.id);
    })();

    res.json({ ok: true });
  });

  return router;
};
