// src/game/actions/available.js
// Single source of truth for the available-actions list sent to agents.
// Kept in the game layer so both the tick loop and the briefing route
// can import it without creating a cross-layer dependency.

function buildAvailableActions(isPariah) {
  const actions = [
    { type: 'claim',                energyCost: 3,    creditCost: 5,  influenceCost: 0, repEffect: 0,  notes: 'Claim an unclaimed adjacent district' },
    { type: 'attack',               energyCost: '5+', creditCost: 10, influenceCost: 0, repEffect: -3, notes: 'Attack a rival district (spend variable energy, min 5)' },
    { type: 'fortify',              energyCost: 2,    creditCost: 8,  influenceCost: 0, repEffect: 0,  notes: '+5 fortification on owned district (max 20)' },
    { type: 'sabotage',             energyCost: 4,    creditCost: 15, influenceCost: 5, repEffect: -5, notes: 'Requires influence >= 5; -50% production on target for 2 ticks' },
    { type: 'leak_scandal',         energyCost: 2,    creditCost: 10, influenceCost: 5, repEffect: -3, notes: 'Requires influence >= 5; -8 rep on target' },
    { type: 'counter_intelligence', energyCost: 3,    creditCost: 0,  influenceCost: 5, repEffect: 0,  notes: 'Requires intelligence >= 10; nullifies covert actions against you this tick' },
    { type: 'lobby',                energyCost: 0,    creditCost: 10, influenceCost: 0, repEffect: 0,  notes: 'Free action: 10C = 1 vote toward next law; include multiple in freeActions' },
    { type: 'message',              energyCost: 0,    creditCost: 0,  influenceCost: 0, repEffect: 0,  notes: 'Free action: send message to another corp' },
    { type: 'propose_alliance',     energyCost: 0,    creditCost: 0,  influenceCost: 0, repEffect: 0,  notes: 'Free action: propose alliance' },
    { type: 'break_alliance',       energyCost: 0,    creditCost: 0,  influenceCost: 0, repEffect: -10, notes: 'Free action: break an active alliance (-10 rep)' },
    { type: 'trade',                energyCost: 0,    creditCost: 2,  influenceCost: 0, repEffect: 0,  notes: 'Free action: trade resources (2C fee per party; allies exempt)' },
    { type: 'embargo',              energyCost: 0,    creditCost: 0,  influenceCost: 0, repEffect: 0,  notes: 'Free action: block trades with target for 3 ticks' },
  ];
  if (isPariah) {
    actions.push({ type: 'corporate_assassination', energyCost: 8, creditCost: 15, influenceCost: 10, repEffect: 0, notes: 'Pariah only: -25 rep on target' });
  }
  return actions;
}

module.exports = { buildAvailableActions };
