// src/game/briefing.js
// Single source of truth for building per-corp briefing payloads.
// Used by both the tick loop (stored DB snapshot) and the /briefing route
// (live fallback when no stored briefing is available).

const { calculateValuation } = require('./valuation');
const { getActiveLaw } = require('./laws');
const { getReputationLabel, PARIAH_THRESHOLD } = require('./reputation');
const { buildAvailableActions } = require('./actions/available');

function buildBriefingPayload(db, corp, season) {
  const tick = season.tick_count;

  const holdings = db.prepare(
    'SELECT id, name, type, fortification_level, adjacent_ids FROM districts WHERE owner_id = ?'
  ).all(corp.id).map(d => {
    try { return { ...d, adjacent_ids: JSON.parse(d.adjacent_ids) }; }
    catch { return { ...d, adjacent_ids: [] }; }
  });

  const alliances = db.prepare(`
    SELECT
      a.id AS alliance_id,
      CASE WHEN corp_a_id = ? THEN corp_b_id ELSE corp_a_id END AS allied_corp_id,
      c.name AS allied_corp_name
    FROM alliances a
    JOIN corporations c
      ON c.id = (CASE WHEN corp_a_id = ? THEN corp_b_id ELSE corp_a_id END)
    WHERE (corp_a_id = ? OR corp_b_id = ?) AND formed_tick IS NOT NULL AND broken_tick IS NULL
  `).all(corp.id, corp.id, corp.id, corp.id);

  const recentEvents = db.prepare(
    'SELECT narrative FROM events WHERE season_id = ? AND tick >= ? ORDER BY tick DESC LIMIT 10'
  ).all(corp.season_id, Math.max(0, tick - 3)).map(e => e.narrative);

  const messages = db.prepare(
    'SELECT from_corp_id, text FROM messages WHERE to_corp_id = ? AND delivered_tick = ?'
  ).all(corp.id, tick);

  const headlines = db.prepare(
    "SELECT narrative FROM events WHERE season_id = ? AND type = 'headline' AND tick = ?"
  ).all(corp.season_id, tick)
    .flatMap(e => e.narrative.split('\n'))
    .filter(h => h.trim() !== '');

  const pendingAlliances = db.prepare(`
    SELECT a.id AS alliance_id, a.corp_a_id AS proposing_corp_id, c.name AS proposing_corp_name
    FROM alliances a
    JOIN corporations c ON c.id = a.corp_a_id
    WHERE a.corp_b_id = ? AND a.formed_tick IS NULL AND a.broken_tick IS NULL
  `).all(corp.id);

  const pendingTrades = db.prepare(`
    SELECT t.id AS trade_id, t.proposing_corp_id, c.name AS proposing_corp_name,
           t.offer, t.request
    FROM trades t
    JOIN corporations c ON c.id = t.proposing_corp_id
    WHERE t.target_corp_id = ?
      AND t.accepted_tick IS NULL
      AND t.declined_tick IS NULL
  `).all(corp.id).map(t => ({
    trade_id: t.trade_id,
    proposing_corp_id: t.proposing_corp_id,
    proposing_corp_name: t.proposing_corp_name,
    offer: (() => { try { return JSON.parse(t.offer); } catch { return {}; } })(),
    request: (() => { try { return JSON.parse(t.request); } catch { return {}; } })(),
  }));

  const laws = db.prepare(
    'SELECT id, name, effect, is_active FROM laws WHERE season_id = ? ORDER BY name ASC'
  ).all(corp.season_id);

  const activeLaw = getActiveLaw(db, corp.season_id);
  const reputationLabel = getReputationLabel(corp.reputation);
  const isPariah = corp.reputation < PARIAH_THRESHOLD;

  return {
    tick,
    generating: false,
    nextTickAt: (season.last_tick_at || 0) + (season.tick_interval_ms || 0),
    valuation: calculateValuation(corp, holdings.length),
    rank: null,
    holdings,
    resources: {
      credits: corp.credits,
      energy: corp.energy,
      workforce: corp.workforce,
      intelligence: corp.intelligence,
      influence: corp.influence,
      politicalPower: corp.political_power,
    },
    events: recentEvents,
    messages,
    headlines,
    reputation: corp.reputation,
    reputationLabel,
    alliances,
    pendingAlliances,
    pendingTrades,
    laws,
    activeLaw: activeLaw || null,
    availableActions: buildAvailableActions(isPariah),
    narrative: null,
  };
}

module.exports = { buildBriefingPayload };
