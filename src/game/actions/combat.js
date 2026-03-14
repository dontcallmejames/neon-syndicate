// src/game/actions/combat.js
const { writeEvent } = require('../events');

function computeDefenseStrength(db, district, defender) {
  const adjacentIds = JSON.parse(district.adjacent_ids || '[]');

  let allianceBonus = 0;
  if (adjacentIds.length > 0) {
    const alliedIds = db.prepare(`
      SELECT CASE WHEN corp_a_id = ? THEN corp_b_id ELSE corp_a_id END AS allied_id
      FROM alliances
      WHERE (corp_a_id = ? OR corp_b_id = ?) AND formed_tick IS NOT NULL AND broken_tick IS NULL
    `).all(defender.id, defender.id, defender.id).map(r => r.allied_id);

    if (alliedIds.length > 0) {
      const placeholders = adjacentIds.map(() => '?').join(',');
      const adjacentOwners = db.prepare(
        `SELECT DISTINCT owner_id FROM districts WHERE id IN (${placeholders}) AND owner_id IS NOT NULL`
      ).all(...adjacentIds).map(r => r.owner_id);

      const qualifyingAllies = alliedIds.filter(id => adjacentOwners.includes(id));
      allianceBonus = Math.min(qualifyingAllies.length * 2, 4);
    }
  }

  return district.fortification_level + defender.workforce + allianceBonus;
}

function getClaimCosts(db, seasonId) {
  const law = db.prepare("SELECT effect FROM laws WHERE season_id = ? AND is_active = 1").get(seasonId);
  if (law && law.effect === 'open_borders') {
    return { energy: Math.floor(3 * 0.5), credits: Math.floor(5 * 0.5) };
  }
  return { energy: 3, credits: 5 };
}

function resolveCombat(db, seasonId, tick, combatActions) {
  const claims  = combatActions.filter(ca => ca.action.type === 'claim');
  const attacks = combatActions.filter(ca => ca.action.type === 'attack');

  // --- Claims (first-come, but simultaneous within a tick: process in order) ---
  for (const { corpId, action } of claims) {
    const district = db.prepare('SELECT * FROM districts WHERE id = ?').get(action.targetDistrictId);
    if (!district || district.owner_id !== null) continue; // race: already taken

    const costs = getClaimCosts(db, seasonId);
    db.prepare('UPDATE districts SET owner_id = ? WHERE id = ?').run(corpId, district.id);
    db.prepare('UPDATE corporations SET energy = energy - ?, credits = credits - ? WHERE id = ?')
      .run(costs.energy, costs.credits, corpId);

    const corp = db.prepare('SELECT name FROM corporations WHERE id = ?').get(corpId);
    writeEvent(db, {
      seasonId, tick, type: 'claim',
      involvedCorpIds: [corpId],
      involvedDistrictIds: [district.id],
      narrative: `${corp.name} claimed ${district.name}.`,
    });
  }

  // --- Attacks (simultaneous per target district) ---
  const byTarget = {};
  for (const ca of attacks) {
    const t = ca.action.targetDistrictId;
    if (!byTarget[t]) byTarget[t] = [];
    byTarget[t].push(ca);
  }

  for (const [targetId, attackers] of Object.entries(byTarget)) {
    const district = db.prepare('SELECT * FROM districts WHERE id = ?').get(targetId);
    if (!district || !district.owner_id) continue;

    const defender = db.prepare('SELECT * FROM corporations WHERE id = ?').get(district.owner_id);
    const defenseStrength = computeDefenseStrength(db, district, defender);

    // Consume attacker costs and compute strengths
    const results = attackers.map(({ corpId, action }) => {
      const attacker = db.prepare('SELECT * FROM corporations WHERE id = ?').get(corpId);
      const energySpent = action.energySpent;
      const attackStrength = energySpent * 1.5 + attacker.workforce;
      db.prepare(`
        UPDATE corporations
        SET energy = energy - ?, credits = credits - 10, reputation = MAX(0, reputation - 3)
        WHERE id = ?
      `).run(energySpent, corpId);
      return { corpId, attackStrength };
    });

    const maxStrength = Math.max(...results.map(r => r.attackStrength));
    if (maxStrength <= defenseStrength) {
      writeEvent(db, {
        seasonId, tick, type: 'attack_failed',
        involvedCorpIds: [district.owner_id, ...attackers.map(a => a.corpId)],
        involvedDistrictIds: [targetId],
        narrative: `${district.name} repelled ${attackers.length > 1 ? 'multiple attacks' : 'an attack'}.`,
      });
      continue;
    }

    const winners = results.filter(r => r.attackStrength === maxStrength);
    const winner = winners[Math.floor(Math.random() * winners.length)];
    db.prepare('UPDATE districts SET owner_id = ?, fortification_level = 0 WHERE id = ?')
      .run(winner.corpId, targetId);

    const winnerCorp = db.prepare('SELECT name FROM corporations WHERE id = ?').get(winner.corpId);
    writeEvent(db, {
      seasonId, tick, type: 'attack_success',
      involvedCorpIds: [winner.corpId, district.owner_id],
      involvedDistrictIds: [targetId],
      narrative: `${winnerCorp.name} seized ${district.name} from ${defender.name}.`,
    });
  }
}

module.exports = { resolveCombat };
