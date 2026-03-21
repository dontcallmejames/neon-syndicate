// src/game/actions/trades.js
const crypto = require('crypto');
const { writeEvent } = require('../events');

const RESOURCE_COL_MAP = {
  credits: 'credits',
  energy: 'energy',
  workforce: 'workforce',
  intelligence: 'intelligence',
  influence: 'influence',
  politicalPower: 'political_power',
};

function transferResource(db, resource, amount, fromId, toId) {
  const col = RESOURCE_COL_MAP[resource];
  if (!col) return;
  db.prepare(`UPDATE corporations SET ${col} = ${col} - ? WHERE id = ?`).run(amount, fromId);
  db.prepare(`UPDATE corporations SET ${col} = ${col} + ? WHERE id = ?`).run(amount, toId);
}

function isAllied(db, corpAId, corpBId) {
  return !!db.prepare(`
    SELECT id FROM alliances
    WHERE ((corp_a_id = ? AND corp_b_id = ?) OR (corp_a_id = ? AND corp_b_id = ?))
      AND formed_tick IS NOT NULL AND broken_tick IS NULL
  `).get(corpAId, corpBId, corpBId, corpAId);
}

function isEmbargoed(db, corpId, targetId, tick) {
  return !!db.prepare(
    'SELECT id FROM embargoes WHERE corp_id = ? AND target_corp_id = ? AND expires_tick >= ?'
  ).get(corpId, targetId, tick);
}

function resolveTrades(db, seasonId, tick, tradeActions) {
  const law = db.prepare("SELECT effect FROM laws WHERE season_id = ? AND is_active = 1 ORDER BY rowid LIMIT 1").get(seasonId);
  const freeTradeActive = law && law.effect === 'free_trade';

  outer: for (const { corpId, action } of tradeActions) {

    // ── propose_trade ─────────────────────────────────────────────
    if (action.type === 'propose_trade') {
      const { targetCorpId, offer, request } = action;
      if (!targetCorpId || !offer || !request) continue;
      if (isEmbargoed(db, corpId, targetCorpId, tick)) continue;
      if (isEmbargoed(db, targetCorpId, corpId, tick)) continue;

      // Verify proposing corp has enough of what they're offering
      const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(corpId);
      for (const [res, amt] of Object.entries(offer)) {
        const col = RESOURCE_COL_MAP[res];
        if (!col || corp[col] < amt) continue outer;
      }

      db.prepare(`
        INSERT INTO trades (id, season_id, proposing_corp_id, target_corp_id, offer, request, proposed_tick)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), seasonId, corpId, targetCorpId,
             JSON.stringify(offer), JSON.stringify(request), tick);
      continue;
    }

    // ── accept_trade ──────────────────────────────────────────────
    if (action.type === 'accept_trade') {
      const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(action.tradeId);
      if (!trade) continue;
      if (trade.target_corp_id !== corpId) continue;
      if (trade.accepted_tick !== null || trade.declined_tick !== null) continue;

      const offer   = JSON.parse(trade.offer);
      const request = JSON.parse(trade.request);

      // Re-verify proposer still has enough
      const proposer = db.prepare('SELECT * FROM corporations WHERE id = ?').get(trade.proposing_corp_id);
      for (const [res, amt] of Object.entries(offer)) {
        const col = RESOURCE_COL_MAP[res];
        if (!col || proposer[col] < amt) continue outer;
      }
      // Verify acceptor has enough to give back
      const acceptor = db.prepare('SELECT * FROM corporations WHERE id = ?').get(corpId);
      for (const [res, amt] of Object.entries(request)) {
        const col = RESOURCE_COL_MAP[res];
        if (!col || acceptor[col] < amt) continue outer;
      }

      // Execute transfer
      for (const [res, amt] of Object.entries(offer)) {
        transferResource(db, res, amt, trade.proposing_corp_id, corpId);
      }
      for (const [res, amt] of Object.entries(request)) {
        transferResource(db, res, amt, corpId, trade.proposing_corp_id);
      }

      const fee = (freeTradeActive || isAllied(db, trade.proposing_corp_id, corpId)) ? 0 : 2;
      if (fee > 0) {
        db.prepare('UPDATE corporations SET credits = credits - ? WHERE id = ?').run(fee, trade.proposing_corp_id);
        db.prepare('UPDATE corporations SET credits = credits - ? WHERE id = ?').run(fee, corpId);
      }

      db.prepare('UPDATE trades SET accepted_tick = ? WHERE id = ?').run(tick, trade.id);

      const p = db.prepare('SELECT name FROM corporations WHERE id = ?').get(trade.proposing_corp_id);
      const a = db.prepare('SELECT name FROM corporations WHERE id = ?').get(corpId);
      writeEvent(db, {
        seasonId, tick, type: 'trade',
        involvedCorpIds: [trade.proposing_corp_id, corpId],
        narrative: `${p.name} and ${a.name} completed a trade.`,
      });
      continue;
    }

    // ── decline_trade ─────────────────────────────────────────────
    if (action.type === 'decline_trade') {
      const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(action.tradeId);
      if (!trade) continue;
      if (trade.target_corp_id !== corpId) continue;
      if (trade.accepted_tick !== null || trade.declined_tick !== null) continue;
      db.prepare('UPDATE trades SET declined_tick = ? WHERE id = ?').run(tick, trade.id);
      continue;
    }
  }
}

module.exports = { resolveTrades };
