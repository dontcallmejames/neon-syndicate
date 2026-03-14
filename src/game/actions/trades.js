// src/game/actions/trades.js
const { writeEvent } = require('../events');

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

function offerMatches(offer, request) {
  const offerKeys = Object.keys(offer);
  const requestKeys = Object.keys(request);
  if (offerKeys.length !== requestKeys.length) return false;
  return offerKeys.every(k => request[k] === offer[k]);
}

function resolveTrades(db, seasonId, tick, tradeActions) {
  const law = db.prepare("SELECT effect FROM laws WHERE season_id = ? AND is_active = 1 ORDER BY rowid LIMIT 1").get(seasonId);
  const freeTradeActive = law && law.effect === 'free_trade';

  // Index by corpId for O(1) lookup
  const byCorpId = {};
  for (const ta of tradeActions) {
    byCorpId[ta.corpId] = ta.action;
  }

  const matched = new Set();

  for (const { corpId, action } of tradeActions) {
    if (matched.has(corpId)) continue;
    const { withCorpId, offer, request } = action;

    if (matched.has(withCorpId)) continue;

    // Check embargo in both directions
    if (isEmbargoed(db, corpId, withCorpId, tick) || isEmbargoed(db, withCorpId, corpId, tick)) continue;

    const counterAction = byCorpId[withCorpId];
    if (!counterAction || counterAction.withCorpId !== corpId) continue;
    if (!offerMatches(offer, counterAction.request)) continue;
    if (!offerMatches(counterAction.offer, request)) continue;

    // Matched — execute transfer
    matched.add(corpId);
    matched.add(withCorpId);

    const fee = (freeTradeActive || isAllied(db, corpId, withCorpId)) ? 0 : 2;

    // Transfer offer from corpId to withCorpId
    for (const [resource, amount] of Object.entries(offer)) {
      const col = resource === 'politicalPower' ? 'political_power' : resource;
      db.prepare(`UPDATE corporations SET ${col} = ${col} - ? WHERE id = ?`).run(amount, corpId);
      db.prepare(`UPDATE corporations SET ${col} = ${col} + ? WHERE id = ?`).run(amount, withCorpId);
    }
    // Transfer counterOffer from withCorpId to corpId
    for (const [resource, amount] of Object.entries(counterAction.offer)) {
      const col = resource === 'politicalPower' ? 'political_power' : resource;
      db.prepare(`UPDATE corporations SET ${col} = ${col} - ? WHERE id = ?`).run(amount, withCorpId);
      db.prepare(`UPDATE corporations SET ${col} = ${col} + ? WHERE id = ?`).run(amount, corpId);
    }
    // Apply fees
    if (fee > 0) {
      db.prepare('UPDATE corporations SET credits = credits - ? WHERE id = ?').run(fee, corpId);
      db.prepare('UPDATE corporations SET credits = credits - ? WHERE id = ?').run(fee, withCorpId);
    }

    const c1 = db.prepare('SELECT name FROM corporations WHERE id = ?').get(corpId);
    const c2 = db.prepare('SELECT name FROM corporations WHERE id = ?').get(withCorpId);
    writeEvent(db, {
      seasonId, tick, type: 'trade',
      involvedCorpIds: [corpId, withCorpId],
      narrative: `${c1.name} and ${c2.name} completed a trade.`,
    });
  }
}

module.exports = { resolveTrades };
