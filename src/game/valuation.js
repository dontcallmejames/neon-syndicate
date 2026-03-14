// src/game/valuation.js
function calculateValuation(corp, districtCount) {
  return (districtCount * 50)
    + corp.credits
    + corp.energy
    + corp.workforce
    + corp.intelligence
    + corp.influence
    + (corp.reputation * 10)
    + (corp.political_power * 15);
}

module.exports = { calculateValuation };
