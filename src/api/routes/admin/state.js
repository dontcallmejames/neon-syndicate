// src/api/routes/admin/state.js
module.exports = function adminStateHandler(db) {
  return (req, res) => {
    const SEASON_COLS = 'id, status, tick_count, season_length, tick_interval_ms, is_ticking, scoring_weights, starting_resources, created_at';

    // Find most recent non-ended season; fall back to any season
    let season = db.prepare(
      `SELECT ${SEASON_COLS} FROM seasons WHERE status != 'ended' ORDER BY created_at DESC LIMIT 1`
    ).get();
    if (!season) {
      season = db.prepare(`SELECT ${SEASON_COLS} FROM seasons ORDER BY created_at DESC LIMIT 1`).get() || null;
    }

    if (!season) {
      return res.json({ season: null, corps: [], districts: [], activeLaw: null, recentEvents: [] });
    }

    const seasonOut = {
      id: season.id,
      status: season.status,
      tick_count: season.tick_count,
      season_length: season.season_length,
      tick_interval_ms: season.tick_interval_ms,
      is_ticking: season.is_ticking === 1,
      scoring_weights: JSON.parse(season.scoring_weights || '{}'),
      starting_resources: JSON.parse(season.starting_resources || '{}'),
    };

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

    const districts = db.prepare(`
      SELECT d.id, d.name, d.type, d.owner_id AS ownerId, c.name AS ownerName
      FROM districts d LEFT JOIN corporations c ON c.id = d.owner_id
      WHERE d.season_id = ?
      ORDER BY d.rowid ASC
    `).all(season.id);

    const activeLaw = db.prepare(
      'SELECT id, name, effect FROM laws WHERE season_id = ? AND is_active = 1'
    ).get(season.id) || null;

    const recentEvents = db.prepare(
      "SELECT id, type, tick, narrative FROM events WHERE season_id = ? ORDER BY tick DESC, rowid DESC LIMIT 10"
    ).all(season.id);

    res.json({ season: seasonOut, corps, districts, activeLaw, recentEvents });
  };
};
