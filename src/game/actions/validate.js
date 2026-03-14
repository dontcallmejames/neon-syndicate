// src/game/actions/validate.js

const PRIMARY_BASE_COSTS = {
  claim:                   { energy: 3, credits: 5,  influence: 0 },
  attack:                  { energy: null, credits: 10, influence: 0 }, // energy = energySpent
  fortify:                 { energy: 2, credits: 8,  influence: 0 },
  sabotage:                { energy: 4, credits: 15, influence: 5 },
  leak_scandal:            { energy: 2, credits: 10, influence: 5 },
  counter_intelligence:    { energy: 3, credits: 0,  influence: 5 },
  corporate_assassination: { energy: 8, credits: 15, influence: 10 },
};

const COVERT_OPS = ['sabotage', 'leak_scandal', 'corporate_assassination'];

function getActiveLawEffect(db, seasonId) {
  const law = db.prepare("SELECT effect FROM laws WHERE season_id = ? AND is_active = 1").get(seasonId);
  return law ? law.effect : null;
}

function computePrimaryEnergyCost(actionType, action, lawEffect, db) {
  if (actionType === 'attack') {
    const base = action.energySpent || 0;
    if (lawEffect === 'labor_zone_attack_cost' && action.targetDistrictId) {
      const d = db.prepare('SELECT type FROM districts WHERE id = ?').get(action.targetDistrictId);
      if (d && d.type === 'labor_zone') return base + 5;
    }
    return base;
  }
  const base = PRIMARY_BASE_COSTS[actionType];
  if (!base) return 0;
  let cost = base.energy;
  if (actionType === 'claim' && lawEffect === 'open_borders') cost = Math.floor(cost * 0.5);
  if ((actionType === 'sabotage' || actionType === 'leak_scandal') && lawEffect === 'security_lockdown') cost *= 2;
  return cost;
}

function computePrimaryCreditCost(actionType, lawEffect) {
  const base = PRIMARY_BASE_COSTS[actionType];
  if (!base) return 0;
  let cost = base.credits;
  if (actionType === 'claim' && lawEffect === 'open_borders') cost = Math.floor(cost * 0.5);
  if (actionType === 'fortify' && lawEffect === 'fortify_discount') cost = Math.floor(cost * 0.5);
  return cost;
}

function computePrimaryInfluenceCost(actionType, lawEffect, isPariah) {
  if (isPariah && COVERT_OPS.includes(actionType)) return 0;
  const base = PRIMARY_BASE_COSTS[actionType];
  if (!base) return 0;
  let cost = base.influence;
  if ((actionType === 'sabotage' || actionType === 'leak_scandal') && lawEffect === 'crackdown') cost *= 2;
  return cost;
}

function validateActions(db, corp, parsedActions, tick) {
  const { primaryAction, freeActions = [] } = parsedActions;
  const isPariah = corp.reputation < 15;
  const lawEffect = getActiveLawEffect(db, corp.season_id);

  let totalEnergy = 0;
  let totalCredits = 0;
  let totalInfluence = 0;

  // --- Validate primary action ---
  if (primaryAction) {
    const { type } = primaryAction;

    if (!PRIMARY_BASE_COSTS[type]) {
      return { valid: false, reason: `unknown primary action type: ${type}` };
    }

    // Pariah-only check
    if (type === 'corporate_assassination' && !isPariah) {
      return { valid: false, reason: 'corporate_assassination requires Pariah status' };
    }

    // Attack minimum energy spend
    if (type === 'attack') {
      if (!primaryAction.energySpent || primaryAction.energySpent < 5) {
        return { valid: false, reason: 'attack requires minimum 5 energy spent' };
      }
    }

    // intelligence minimum for counter_intelligence
    if (type === 'counter_intelligence' && corp.intelligence < 10) {
      return { valid: false, reason: 'counter_intelligence requires intelligence >= 10' };
    }

    // influence minimum for covert ops (non-Pariah)
    if (!isPariah && COVERT_OPS.includes(type) && corp.influence < 5) {
      return { valid: false, reason: `${type} requires influence >= 5` };
    }

    // Accumulate costs
    const energyCost = computePrimaryEnergyCost(type, primaryAction, lawEffect, db);
    const creditCost = computePrimaryCreditCost(type, lawEffect);
    const influenceCost = computePrimaryInfluenceCost(type, lawEffect, isPariah);

    totalEnergy += energyCost;
    totalCredits += creditCost;
    totalInfluence += influenceCost;
  }

  // --- Validate free actions ---
  const isTrusted = corp.reputation >= 75;
  const lobbyMinCredits = isTrusted ? 8 : 10; // Trusted: -20% lobbying cost
  for (const action of freeActions) {
    if (action.type === 'lobby') {
      if (isPariah) return { valid: false, reason: 'Pariah corps cannot lobby' };
      if (!action.lawId) return { valid: false, reason: 'lobby requires a lawId' };
      const lawExists = db.prepare('SELECT id FROM laws WHERE id = ? AND season_id = ?').get(action.lawId, corp.season_id);
      if (!lawExists) return { valid: false, reason: `lobby: law ${action.lawId} not found` };
      if (!action.credits || action.credits < lobbyMinCredits) {
        return { valid: false, reason: `lobby requires at least ${lobbyMinCredits} credits per entry` };
      }
      totalCredits += action.credits;
    }
    // trade: 2C fee only charged at resolution if matched; not validated upfront
  }

  // --- Check totals against current corp balances ---
  if (corp.energy < totalEnergy) {
    return { valid: false, reason: `insufficient energy (need ${totalEnergy}, have ${corp.energy})` };
  }
  if (corp.credits < totalCredits) {
    return { valid: false, reason: `insufficient credits (need ${totalCredits}, have ${corp.credits})` };
  }
  if (corp.influence < totalInfluence) {
    return { valid: false, reason: `insufficient influence (need ${totalInfluence}, have ${corp.influence})` };
  }

  return { valid: true };
}

module.exports = { validateActions };
