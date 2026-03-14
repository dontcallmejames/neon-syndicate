// src/game/phase.js
const crypto = require('crypto');
const { writeEvent } = require('./events');

function checkPhase(db, seasonId, tick) {
  if (tick % 10 !== 0) return;

  const currentPhase = db.prepare(
    'SELECT * FROM phases WHERE season_id = ? AND end_tick IS NULL ORDER BY phase_number ASC LIMIT 1'
  ).get(seasonId);

  if (!currentPhase) return;

  // Government Quarter holder gets double votes
  const govQuarter = db.prepare(
    "SELECT owner_id FROM districts WHERE season_id = ? AND type = 'government_quarter' AND owner_id IS NOT NULL"
  ).get(seasonId);

  // Build a weighted vote map: lawId → effective vote count
  // Trusted corps (rep >= 75) get 1 vote per 8 credits; others: 1 vote per 10 credits
  const voteMap = {};
  const allVoteRows = db.prepare(`
    SELECT lv.law_id, lv.corp_id, lv.credits, c.reputation
    FROM lobby_votes lv
    JOIN corporations c ON c.id = lv.corp_id
    WHERE lv.phase_id = ?
  `).all(currentPhase.id);

  for (const v of allVoteRows) {
    const costPerVote = v.reputation >= 75 ? 8 : 10;
    const votes = Math.floor(v.credits / costPerVote);
    voteMap[v.law_id] = (voteMap[v.law_id] || 0) + votes;
  }

  // Government Quarter holder's votes are doubled (add their contribution a second time)
  if (govQuarter && govQuarter.owner_id) {
    const gqVoteRows = allVoteRows.filter(v => v.corp_id === govQuarter.owner_id);
    for (const v of gqVoteRows) {
      const costPerVote = v.reputation >= 75 ? 8 : 10;
      const votes = Math.floor(v.credits / costPerVote);
      voteMap[v.law_id] = (voteMap[v.law_id] || 0) + votes; // add one more time = doubled
    }
  }

  // Get all laws for this season
  const allLaws = db.prepare('SELECT * FROM laws WHERE season_id = ?').all(seasonId);

  // Build weighted pool
  const totalVotes = Object.values(voteMap).reduce((a, b) => a + b, 0);
  let winner;

  if (totalVotes === 0) {
    // Equal probability — pick randomly
    winner = allLaws[Math.floor(Math.random() * allLaws.length)];
  } else {
    const rand = Math.random() * totalVotes;
    let cumulative = 0;
    for (const law of allLaws) {
      cumulative += (voteMap[law.id] || 0);
      if (rand <= cumulative) {
        winner = law;
        break;
      }
    }
    if (!winner) winner = allLaws[allLaws.length - 1];
  }

  // Deactivate previous law, activate winner
  db.prepare('UPDATE laws SET is_active = 0 WHERE season_id = ?').run(seasonId);
  db.prepare('UPDATE laws SET is_active = 1, active_since = ? WHERE id = ?').run(tick, winner.id);

  // Close current phase
  db.prepare('UPDATE phases SET end_tick = ?, resolved_law_id = ? WHERE id = ?')
    .run(tick, winner.id, currentPhase.id);

  // Open next phase
  db.prepare('INSERT INTO phases (id, season_id, phase_number, start_tick) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), seasonId, currentPhase.phase_number + 1, tick + 1);

  writeEvent(db, {
    seasonId, tick, type: 'law_enacted',
    narrative: `The city council enacted: ${winner.name}.`,
  });
}

module.exports = { checkPhase };
