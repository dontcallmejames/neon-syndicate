// src/game/resources.js
const { getDb } = require('../db/index');

const PRODUCTION = {
  data_center:        { intelligence: 3 },
  power_grid:         { energy: 4 },
  labor_zone:         { workforce: 3 },
  financial_hub:      { credits: 4 },
  black_market:       { influence: 2, reputation: -2 },
  government_quarter: { political_power: 3 },
};

const RESOURCE_KEYS = ['credits', 'energy', 'workforce', 'intelligence', 'influence', 'political_power'];

function generateResources(db, seasonId) {
  const conn = db || getDb();
  const corps = conn.prepare('SELECT * FROM corporations WHERE season_id = ?').all(seasonId);

  for (const corp of corps) {
    // Districts ordered by rowid (insertion order = acquisition order)
    const districts = conn.prepare(
      'SELECT * FROM districts WHERE season_id = ? AND owner_id = ? ORDER BY rowid ASC'
    ).all(seasonId, corp.id);

    // First pass: calculate post-generation workforce to determine enforcement threshold
    let workforceDelta = 0;
    for (const district of districts) {
      workforceDelta += (PRODUCTION[district.type] || {}).workforce || 0;
    }
    const postGenWorkforce = corp.workforce + workforceDelta;
    // Districts beyond postGenWorkforce threshold (most recently acquired) produce at 50%
    const fullCount = Math.min(postGenWorkforce, districts.length);

    // Second pass: calculate all resource deltas with enforcement applied
    const delta = Object.fromEntries([...RESOURCE_KEYS, 'reputation'].map(k => [k, 0]));

    districts.forEach((district, index) => {
      const production = PRODUCTION[district.type] || {};
      const multiplier = index < fullCount ? 1 : 0.5;

      for (const [resource, amount] of Object.entries(production)) {
        if (resource === 'reputation') {
          // Reputation changes are never affected by workforce enforcement
          delta.reputation += amount;
        } else {
          delta[resource] = (delta[resource] || 0) + Math.floor(amount * multiplier);
        }
      }
    });

    // Apply delta; clamp reputation to 0–100
    const newRep = Math.max(0, Math.min(100, corp.reputation + delta.reputation));

    conn.prepare(`
      UPDATE corporations SET
        credits          = credits + ?,
        energy           = energy + ?,
        workforce        = workforce + ?,
        intelligence     = intelligence + ?,
        influence        = influence + ?,
        political_power  = political_power + ?,
        reputation       = ?
      WHERE id = ?
    `).run(
      delta.credits, delta.energy, delta.workforce,
      delta.intelligence, delta.influence, delta.political_power,
      newRep, corp.id
    );
  }
}

module.exports = { generateResources, PRODUCTION };
