// tests/game/valuation.test.js
const { calculateValuation } = require('../../src/game/valuation');

test('calculateValuation sums all components correctly', () => {
  const corp = { credits: 10, energy: 8, workforce: 6, intelligence: 4, influence: 0, political_power: 3, reputation: 50 };
  const result = calculateValuation(corp, 2);
  // (2*50) + 10 + 8 + 6 + 4 + 0 + (50*10) + (3*15) = 100+28+500+45 = 673
  expect(result).toBe(673);
});

test('calculateValuation with zero districts', () => {
  const corp = { credits: 0, energy: 0, workforce: 0, intelligence: 0, influence: 0, political_power: 0, reputation: 50 };
  expect(calculateValuation(corp, 0)).toBe(500);
});
