// src/game/actions/covert.js
const { writeEvent } = require('../events');

function getFortifyCreditCost(db, seasonId) {
  const law = db.prepare(
    "SELECT id FROM laws WHERE season_id = ? AND is_active = 1 AND effect = 'fortify_discount' LIMIT 1"
  ).get(seasonId);
  return law ? 4 : 8;
}

function resolveCovert(db, seasonId, tick, covertActions) {
  for (const { corpId, action } of covertActions) {
    const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(corpId);

    if (action.type === 'fortify') {
      const district = db.prepare('SELECT * FROM districts WHERE id = ?').get(action.targetDistrictId);
      if (!district || district.owner_id !== corpId) continue;
      const newFort = Math.min(20, district.fortification_level + 5);
      const creditCost = getFortifyCreditCost(db, seasonId);
      db.prepare('UPDATE districts SET fortification_level = ? WHERE id = ?').run(newFort, district.id);
      db.prepare('UPDATE corporations SET energy = energy - 2, credits = credits - ? WHERE id = ?')
        .run(creditCost, corpId);
      writeEvent(db, {
        seasonId, tick, type: 'fortify',
        involvedCorpIds: [corpId], involvedDistrictIds: [district.id],
        narrative: `${corp.name} fortified ${district.name} to level ${newFort}.`,
      });
      continue;
    }

    if (action.type === 'sabotage') {
      const district = db.prepare('SELECT * FROM districts WHERE id = ?').get(action.targetDistrictId);
      if (!district) continue;
      db.prepare('UPDATE districts SET sabotaged_until = ? WHERE id = ?').run(tick + 2, district.id);
      db.prepare('UPDATE corporations SET energy = energy - 4, credits = credits - 15, reputation = MAX(0, reputation - 5) WHERE id = ?')
        .run(corpId);
      writeEvent(db, {
        seasonId, tick, type: 'sabotage',
        involvedCorpIds: [corpId], involvedDistrictIds: [district.id],
        narrative: `${corp.name} sabotaged ${district.name}.`,
      });
      continue;
    }

    if (action.type === 'leak_scandal') {
      const target = db.prepare('SELECT * FROM corporations WHERE id = ?').get(action.targetCorpId);
      if (!target) continue;
      db.prepare('UPDATE corporations SET reputation = MAX(0, reputation - 8) WHERE id = ?').run(target.id);
      db.prepare('UPDATE corporations SET energy = energy - 2, credits = credits - 10, reputation = MAX(0, reputation - 3) WHERE id = ?')
        .run(corpId);
      writeEvent(db, {
        seasonId, tick, type: 'leak_scandal',
        involvedCorpIds: [corpId, target.id],
        narrative: `A scandal broke out involving ${target.name}.`,
      });
      continue;
    }

    if (action.type === 'corporate_assassination') {
      const target = db.prepare('SELECT * FROM corporations WHERE id = ?').get(action.targetCorpId);
      if (!target) continue;
      db.prepare('UPDATE corporations SET reputation = MAX(0, reputation - 25) WHERE id = ?').run(target.id);
      db.prepare('UPDATE corporations SET energy = energy - 8, credits = credits - 15 WHERE id = ?')
        .run(corpId);
      writeEvent(db, {
        seasonId, tick, type: 'corporate_assassination',
        involvedCorpIds: [corpId, target.id],
        narrative: `${corp.name} orchestrated a corporate assassination against ${target.name}.`,
      });
    }
  }
}

module.exports = { resolveCovert };
