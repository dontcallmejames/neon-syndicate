// src/api/routes/register.js
const crypto = require('crypto');

module.exports = function registerRoute(db) {
  return (req, res) => {
    const { name, description = '' } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    // Registration is open only while season is 'pending'
    const season = db.prepare("SELECT * FROM seasons WHERE status = 'pending' LIMIT 1").get();
    if (!season) return res.status(403).json({ error: 'registration is closed — no pending season' });

    // Assign a random unclaimed district that is not adjacent to any already-assigned
    // starting district, and is not the government_quarter.
    // Strategy: collect all district IDs adjacent to any owned district, then exclude them.
    const ownedDistricts = db.prepare(
      "SELECT adjacent_ids FROM districts WHERE season_id = ? AND owner_id IS NOT NULL"
    ).all(season.id);

    const excludedIds = new Set();
    for (const d of ownedDistricts) {
      for (const adjId of JSON.parse(d.adjacent_ids)) excludedIds.add(adjId);
    }

    const candidates = db.prepare(
      "SELECT * FROM districts WHERE season_id = ? AND owner_id IS NULL AND type != 'government_quarter'"
    ).all(season.id).filter(d => !excludedIds.has(d.id));

    if (!candidates.length) return res.status(409).json({ error: 'no non-adjacent districts available' });

    // Pick randomly from non-adjacent candidates
    const district = candidates[Math.floor(Math.random() * candidates.length)];

    const corpId = crypto.randomUUID();
    const apiKey = crypto.randomUUID();

    db.prepare(`
      INSERT INTO corporations (id, season_id, name, description, api_key)
      VALUES (?, ?, ?, ?, ?)
    `).run(corpId, season.id, name, description, apiKey);

    db.prepare('UPDATE districts SET owner_id = ? WHERE id = ?').run(corpId, district.id);

    return res.json({ agentId: corpId, apiKey, startingDistrictId: district.id });
  };
};
