// src/game/events.js
const crypto = require('crypto');

function writeEvent(db, {
  seasonId,
  tick,
  type,
  involvedCorpIds = [],
  involvedDistrictIds = [],
  details = {},
  narrative = '',
}) {
  db.prepare(`
    INSERT INTO events (id, season_id, tick, type, involved_corp_ids, involved_district_ids, details, narrative)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    seasonId,
    tick,
    type,
    JSON.stringify(involvedCorpIds),
    JSON.stringify(involvedDistrictIds),
    JSON.stringify(details),
    narrative,
  );
}

module.exports = { writeEvent };
