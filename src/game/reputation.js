// src/game/reputation.js
// Single source of truth for reputation tiers and thresholds.
// Import from here rather than repeating the ternary everywhere.

const PARIAH_THRESHOLD   = 15;
const NOTORIOUS_THRESHOLD = 15; // reputation < 40 && >= 15
const NEUTRAL_THRESHOLD  = 40;
const TRUSTED_THRESHOLD  = 75;

function getReputationLabel(reputation) {
  if (reputation >= TRUSTED_THRESHOLD)  return 'Trusted';
  if (reputation >= NEUTRAL_THRESHOLD)  return 'Neutral';
  if (reputation >= PARIAH_THRESHOLD)   return 'Notorious';
  return 'Pariah';
}

module.exports = { getReputationLabel, PARIAH_THRESHOLD, NEUTRAL_THRESHOLD, TRUSTED_THRESHOLD };
