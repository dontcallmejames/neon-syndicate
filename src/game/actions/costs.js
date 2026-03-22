// src/game/actions/costs.js
// Single source of truth for primary action base costs.
// Validate, resolve, and combat all read from here — change once, applies everywhere.

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

module.exports = { PRIMARY_BASE_COSTS, COVERT_OPS };
