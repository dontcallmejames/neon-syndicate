// src/api/routes/world.js
const { calculateValuation } = require('../../game/valuation');

module.exports = function worldRoute(conn) {
  return function (_req, res) {
    const season = conn.prepare("SELECT * FROM seasons WHERE status = 'active' LIMIT 1").get();

    if (!season) {
      return res.json({
        type: 'world_state',
        tick: 0,
        districts: [],
        corporations: [],
        alliances: [],
        activeLaw: null,
        headlines: [],
      });
    }

    const districts = conn.prepare(`
      SELECT d.id, d.name, d.type, d.owner_id, c.name AS owner_name,
             d.fortification_level, d.adjacent_ids
      FROM districts d LEFT JOIN corporations c ON c.id = d.owner_id
      WHERE d.season_id = ?
    `).all(season.id);

    const corps = conn.prepare(`
      SELECT id, name, reputation, credits, energy, workforce,
             intelligence, influence, political_power
      FROM corporations WHERE season_id = ? ORDER BY rowid ASC
    `).all(season.id);

    const corporations = corps.map(c => {
      const districtCount = districts.filter(d => d.owner_id === c.id).length;
      const reputationLabel =
        c.reputation >= 75 ? 'Trusted' :
        c.reputation >= 40 ? 'Neutral' :
        c.reputation >= 15 ? 'Notorious' : 'Pariah';
      return {
        id: c.id,
        name: c.name,
        valuation: calculateValuation(c, districtCount),
        reputation: c.reputation,
        reputationLabel,
        districtCount,
      };
    });

    const alliances = conn.prepare(`
      SELECT a.corp_a_id, a.corp_b_id, ca.name AS corp_a_name, cb.name AS corp_b_name
      FROM alliances a
      JOIN corporations ca ON ca.id = a.corp_a_id
      JOIN corporations cb ON cb.id = a.corp_b_id
      WHERE (ca.season_id = ? OR cb.season_id = ?)
        AND a.formed_tick IS NOT NULL AND a.broken_tick IS NULL
    `).all(season.id, season.id);

    const activeLaw = conn.prepare(
      'SELECT name, effect FROM laws WHERE season_id = ? AND is_active = 1'
    ).get(season.id);

    const headlineEvent = conn.prepare(
      "SELECT narrative FROM events WHERE season_id = ? AND type = 'headline' ORDER BY tick DESC LIMIT 1"
    ).get(season.id);
    const headlines = headlineEvent ? headlineEvent.narrative.split('\n') : [];

    res.json({
      type: 'world_state',
      tick: season.tick_count,
      districts: districts.map(d => ({
        id: d.id,
        name: d.name,
        type: d.type,
        ownerId: d.owner_id,
        ownerName: d.owner_name,
        fortificationLevel: d.fortification_level,
        adjacentIds: JSON.parse(d.adjacent_ids),
      })),
      corporations,
      alliances: alliances.map(a => ({
        corpAId: a.corp_a_id,
        corpBId: a.corp_b_id,
        corpAName: a.corp_a_name,
        corpBName: a.corp_b_name,
      })),
      activeLaw: activeLaw || null,
      headlines,
    });
  };
};
