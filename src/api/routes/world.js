// src/api/routes/world.js
const { calculateValuation } = require('../../game/valuation');
const { buildWorldState } = require('../../game/worldState');
const { getActiveLaw } = require('../../game/laws');

module.exports = function worldRoute(conn) {
  return function (_req, res) {
    const season = conn.prepare("SELECT * FROM seasons WHERE status = 'active' ORDER BY created_at DESC LIMIT 1").get();

    if (!season) {
      // Check for a pending or ended season so we can report its status and corps
      const otherSeason = conn.prepare(
        "SELECT * FROM seasons WHERE status IN ('pending', 'ended') ORDER BY created_at DESC LIMIT 1"
      ).get();

      if (!otherSeason) {
        return res.json({
          type: 'world_state',
          status: null,
          tick: 0,
          districts: [],
          corporations: [],
          alliances: [],
          activeLaw: null,
          headlines: [],
        });
      }

      const corps = conn.prepare(
        'SELECT id, name FROM corporations WHERE season_id = ? ORDER BY rowid ASC'
      ).all(otherSeason.id);

      // For ended seasons, include valuation for final standings
      let corporations;
      if (otherSeason.status === 'ended') {
        const allDistricts = conn.prepare(
          'SELECT owner_id FROM districts WHERE season_id = ?'
        ).all(otherSeason.id);
        corporations = corps.map(c => {
          const districtCount = allDistricts.filter(d => d.owner_id === c.id).length;
          const full = conn.prepare(
            'SELECT reputation, credits, energy, workforce, intelligence, influence, political_power FROM corporations WHERE id = ?'
          ).get(c.id);
          return {
            id: c.id, name: c.name,
            valuation: calculateValuation(full, districtCount),
            reputation: full.reputation,
            districtCount,
          };
        });
      } else {
        corporations = corps.map(c => ({ id: c.id, name: c.name }));
      }

      return res.json({
        type: 'world_state',
        status: otherSeason.status,
        tick: otherSeason.tick_count || 0,
        districts: [],
        corporations,
        alliances: [],
        activeLaw: getActiveLaw(conn, otherSeason.id) || null,
        headlines: [],
      });
    }

    const state = buildWorldState(conn, season.id, season.tick_count);
    res.json({ type: 'world_state', status: 'active', ...state });
  };
};
