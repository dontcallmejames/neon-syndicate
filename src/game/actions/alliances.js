// src/game/actions/alliances.js
const crypto = require('crypto');
const { writeEvent } = require('../events');

function activeAllianceCount(db, corpId) {
  return db.prepare(`
    SELECT COUNT(*) as cnt FROM alliances
    WHERE (corp_a_id = ? OR corp_b_id = ?) AND formed_tick IS NOT NULL AND broken_tick IS NULL
  `).get(corpId, corpId).cnt;
}

function resolveAlliances(db, seasonId, tick, allianceActions) {
  for (const { corpId, action } of allianceActions) {
    const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(corpId);

    if (action.type === 'propose_alliance') {
      const targetId = action.targetCorpId;
      // Check not already allied and < 3 active alliances
      if (activeAllianceCount(db, corpId) >= 3) continue;
      const existing = db.prepare(`
        SELECT id FROM alliances
        WHERE (corp_a_id = ? AND corp_b_id = ?) OR (corp_a_id = ? AND corp_b_id = ?)
      `).get(corpId, targetId, targetId, corpId);
      if (existing) continue;

      db.prepare('INSERT INTO alliances (id, corp_a_id, corp_b_id, proposed_tick) VALUES (?, ?, ?, ?)')
        .run(crypto.randomUUID(), corpId, targetId, tick);

      const target = db.prepare('SELECT name FROM corporations WHERE id = ?').get(targetId);
      writeEvent(db, {
        seasonId, tick, type: 'alliance_proposed',
        involvedCorpIds: [corpId, targetId],
        narrative: `${corp.name} proposed an alliance to ${target ? target.name : targetId}.`,
      });
      continue;
    }

    if (action.type === 'accept_alliance') {
      const alliance = db.prepare('SELECT * FROM alliances WHERE id = ?').get(action.allianceId);
      if (!alliance || alliance.corp_b_id !== corpId || alliance.formed_tick !== null) continue;
      if (activeAllianceCount(db, corpId) >= 3) continue;
      if (activeAllianceCount(db, alliance.corp_a_id) >= 3) continue;

      db.prepare('UPDATE alliances SET formed_tick = ? WHERE id = ?').run(tick, alliance.id);
      const other = db.prepare('SELECT name FROM corporations WHERE id = ?').get(alliance.corp_a_id);
      writeEvent(db, {
        seasonId, tick, type: 'alliance_formed',
        involvedCorpIds: [alliance.corp_a_id, corpId],
        narrative: `${corp.name} and ${other ? other.name : alliance.corp_a_id} formed an alliance.`,
      });
      continue;
    }

    if (action.type === 'decline_alliance') {
      const alliance = db.prepare('SELECT * FROM alliances WHERE id = ?').get(action.allianceId);
      if (!alliance || alliance.corp_b_id !== corpId || alliance.formed_tick !== null) continue;
      db.prepare('UPDATE alliances SET broken_tick = ?, broken_by_corp_id = ? WHERE id = ?')
        .run(tick, corpId, alliance.id);
      continue;
    }

    if (action.type === 'break_alliance') {
      const alliance = db.prepare('SELECT * FROM alliances WHERE id = ?').get(action.allianceId);
      if (!alliance || alliance.formed_tick === null || alliance.broken_tick !== null) continue;
      if (alliance.corp_a_id !== corpId && alliance.corp_b_id !== corpId) continue;

      db.prepare('UPDATE alliances SET broken_tick = ?, broken_by_corp_id = ? WHERE id = ?')
        .run(tick, corpId, alliance.id);
      db.prepare('UPDATE corporations SET reputation = MAX(0, reputation - 10) WHERE id = ?').run(corpId);

      const otherId = alliance.corp_a_id === corpId ? alliance.corp_b_id : alliance.corp_a_id;
      const other = db.prepare('SELECT name FROM corporations WHERE id = ?').get(otherId);
      writeEvent(db, {
        seasonId, tick, type: 'alliance_broken',
        involvedCorpIds: [corpId, otherId],
        narrative: `${corp.name} broke their alliance with ${other ? other.name : otherId}.`,
      });
    }
  }
}

module.exports = { resolveAlliances };
