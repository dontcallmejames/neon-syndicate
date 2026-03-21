// src/game/actions/social.js
const crypto = require('crypto');

function resolveSocial(db, seasonId, tick, socialActions, phaseId) {
  for (const { corpId, action } of socialActions) {
    if (action.type === 'message') {
      db.prepare(
        'INSERT INTO messages (id, from_corp_id, to_corp_id, text, delivered_tick) VALUES (?, ?, ?, ?, ?)'
      ).run(crypto.randomUUID(), corpId, action.toCorpId, action.text, tick);
      continue;
    }

    if (action.type === 'lobby' && phaseId) {
      db.prepare(
        'INSERT INTO lobby_votes (id, phase_id, corp_id, law_id, credits) VALUES (?, ?, ?, ?, ?)'
      ).run(crypto.randomUUID(), phaseId, corpId, action.lawId, action.credits);
      db.prepare('UPDATE corporations SET credits = MAX(0, credits - ?) WHERE id = ?')
        .run(action.credits, corpId);
      continue;
    }

    if (action.type === 'embargo') {
      db.prepare(
        'INSERT INTO embargoes (id, corp_id, target_corp_id, expires_tick) VALUES (?, ?, ?, ?)'
      ).run(crypto.randomUUID(), corpId, action.targetCorpId, tick + 3);
    }
  }
}

module.exports = { resolveSocial };
