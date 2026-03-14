// src/game/feared.js
const { writeEvent } = require('./events');

function applyFeared(db, seasonId, tick) {
  const corps = db.prepare(
    'SELECT * FROM corporations WHERE season_id = ? ORDER BY id ASC'
  ).all(seasonId);

  const pariahs  = corps.filter(c => c.reputation < 15);
  const nonPariahs = corps.filter(c => c.reputation >= 15);
  if (pariahs.length === 0) return;

  for (const payer of nonPariahs) {
    let creditsLeft = db.prepare('SELECT credits FROM corporations WHERE id = ?').get(payer.id).credits;
    for (const pariah of pariahs) {
      const amount = Math.min(creditsLeft, 5);
      if (amount <= 0) break;
      db.prepare('UPDATE corporations SET credits = credits - ? WHERE id = ?').run(amount, payer.id);
      db.prepare('UPDATE corporations SET credits = credits + ? WHERE id = ?').run(amount, pariah.id);
      creditsLeft -= amount;
      writeEvent(db, {
        seasonId, tick, type: 'feared',
        involvedCorpIds: [pariah.id, payer.id],
        narrative: `${pariah.name} collected ${amount} credits from ${payer.name}.`,
      });
    }
  }
}

module.exports = { applyFeared };
