// src/game/resources.js
const { getDb } = require('../db/index');

const PRODUCTION = {
  data_center:        { intelligence: 3, credits: 1 },
  power_grid:         { energy: 4, workforce: 1 },
  labor_zone:         { workforce: 3, credits: 1 },
  financial_hub:      { credits: 4, energy: 1 },
  black_market:       { influence: 2, credits: 2, reputation: -1 },
  government_quarter: { political_power: 3, influence: 1, reputation: 1 },
};

const RESOURCE_KEYS = ['credits', 'energy', 'workforce', 'intelligence', 'influence', 'political_power'];

function generateResources(db, seasonId, tick) {
  const conn = db || getDb();
  const activeLaw = conn.prepare(
    "SELECT effect FROM laws WHERE season_id = ? AND is_active = 1"
  ).get(seasonId);
  const lawEffect = activeLaw ? activeLaw.effect : null;
  const corps = conn.prepare('SELECT * FROM corporations WHERE season_id = ?').all(seasonId);

  for (const corp of corps) {
    const districts = conn.prepare(
      'SELECT * FROM districts WHERE season_id = ? AND owner_id = ? ORDER BY rowid ASC'
    ).all(seasonId, corp.id);

    // First pass: compute post-generation workforce to determine enforcement threshold
    let workforceDelta = 0;
    for (const district of districts) {
      workforceDelta += (PRODUCTION[district.type] || {}).workforce || 0;
    }
    const postGenWorkforce = corp.workforce + workforceDelta;
    const fullCount = Math.min(postGenWorkforce, districts.length);

    // Second pass: accumulate resource deltas as floats; floor at DB write
    const delta = Object.fromEntries([...RESOURCE_KEYS, 'reputation'].map(k => [k, 0]));

    districts.forEach((district, index) => {
      const production = PRODUCTION[district.type] || {};
      const workforceMultiplier = index < fullCount ? 1 : 0.5;
      const isSabotaged = tick != null && district.sabotaged_until > tick;
      const sabotageMultiplier = isSabotaged ? 0.5 : 1;

      for (const [resource, amount] of Object.entries(production)) {
        if (resource === 'reputation') {
          delta.reputation += amount; // integer; exempt from sabotage + workforce
        } else {
          let effectiveAmount = amount;
          if (district.type === 'data_center' && resource === 'intelligence' &&
              lawEffect === 'data_center_bonus') {
            effectiveAmount *= 1.2;
          }
          // Multipliers stack: an understaffed sabotaged district produces at 25% (0.5 × 0.5)
          delta[resource] += effectiveAmount * workforceMultiplier * sabotageMultiplier;
        }
      }
    });

    const newRep = Math.max(0, Math.min(100, corp.reputation + delta.reputation));
    conn.prepare(`
      UPDATE corporations SET
        credits         = credits + ?,
        energy          = energy + ?,
        workforce       = workforce + ?,
        intelligence    = intelligence + ?,
        influence       = influence + ?,
        political_power = political_power + ?,
        reputation      = ?
      WHERE id = ?
    `).run(
      Math.floor(delta.credits), Math.floor(delta.energy), Math.floor(delta.workforce),
      Math.floor(delta.intelligence), Math.floor(delta.influence), Math.floor(delta.political_power),
      newRep, corp.id
    );
  }
}

module.exports = { generateResources, PRODUCTION };
