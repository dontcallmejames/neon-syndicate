// src/api/routes/briefing.js
const { calculateValuation } = require('../../game/valuation');
const { buildFallbackNarrative } = require('../../game/gemini');

function briefingRoute(db) {
  return (req, res) => {
    const { agentId } = req.params;
    if (req.corp.id !== agentId) {
      return res.status(403).json({ error: "cannot access another corp's briefing" });
    }

    const corp = req.corp;
    const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(corp.season_id);
    const currentTick = season ? season.tick_count : 0;
    const isGenerating = season ? season.is_ticking === 1 : false;

    // Return stored briefing if it matches the current tick
    const stored = db.prepare(
      'SELECT * FROM briefings WHERE corp_id = ? ORDER BY tick DESC LIMIT 1'
    ).get(corp.id);

    if (stored && stored.tick === currentTick && !isGenerating) {
      const payload = JSON.parse(stored.payload);
      payload.nextTickAt = (season.last_tick_at || 0) + (season.tick_interval_ms || 0);
      return res.json(payload);
    }

    // Build live briefing from current DB state
    const holdings = db.prepare(
      'SELECT id, name, type, fortification_level, adjacent_ids FROM districts WHERE owner_id = ?'
    ).all(corp.id).map(d => ({ ...d, adjacent_ids: JSON.parse(d.adjacent_ids) }));

    const alliances = db.prepare(`
      SELECT
        CASE WHEN corp_a_id = ? THEN corp_b_id ELSE corp_a_id END AS allied_corp_id,
        c.name AS allied_corp_name
      FROM alliances a
      JOIN corporations c
        ON c.id = (CASE WHEN corp_a_id = ? THEN corp_b_id ELSE corp_a_id END)
      WHERE (corp_a_id = ? OR corp_b_id = ?) AND formed_tick IS NOT NULL AND broken_tick IS NULL
    `).all(corp.id, corp.id, corp.id, corp.id);

    const recentEvents = db.prepare(
      'SELECT narrative FROM events WHERE season_id = ? AND tick >= ? ORDER BY tick DESC LIMIT 10'
    ).all(corp.season_id, Math.max(0, currentTick - 3)).map(e => e.narrative);

    const messages = db.prepare(
      'SELECT from_corp_id, text FROM messages WHERE to_corp_id = ? AND delivered_tick = ?'
    ).all(corp.id, currentTick);

    const headlines = db.prepare(
      "SELECT narrative FROM events WHERE season_id = ? AND type = 'headline' AND tick = ?"
    ).all(corp.season_id, currentTick).map(e => e.narrative);

    const pendingAlliances = db.prepare(`
      SELECT a.corp_a_id AS proposing_corp_id, c.name AS proposing_corp_name
      FROM alliances a
      JOIN corporations c ON c.id = a.corp_a_id
      WHERE a.corp_b_id = ? AND a.formed_tick IS NULL AND a.broken_tick IS NULL
    `).all(corp.id);

    const activeLaw = db.prepare(
      'SELECT name, effect FROM laws WHERE season_id = ? AND is_active = 1'
    ).get(corp.season_id);

    const reputationLabel =
      corp.reputation >= 75 ? 'Trusted' :
      corp.reputation >= 40 ? 'Neutral' :
      corp.reputation >= 15 ? 'Notorious' : 'Pariah';

    const isPariah = corp.reputation < 15;

    const payload = {
      tick: currentTick,
      generating: isGenerating,
      nextTickAt: season ? (season.last_tick_at || 0) + (season.tick_interval_ms || 0) : 0,
      valuation: calculateValuation(corp, holdings.length),
      rank: null, // computed during tick loop when all corps are scored
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
      activeLaw: activeLaw || null,
      availableActions: buildAvailableActions(isPariah),
    };
    payload.narrative = buildFallbackNarrative(corp, payload);

    return res.json(payload);
  };
};

module.exports = briefingRoute;
module.exports.buildAvailableActions = buildAvailableActions;

function buildAvailableActions(isPariah) {
  const actions = [
    { type: 'claim',                energyCost: 3,    creditCost: 5,  influenceCost: 0, repEffect: 0,  notes: 'Claim an unclaimed adjacent district' },
    { type: 'attack',               energyCost: '5+', creditCost: 10, influenceCost: 0, repEffect: -3, notes: 'Attack a rival district (spend variable energy, min 5)' },
    { type: 'fortify',              energyCost: 2,    creditCost: 8,  influenceCost: 0, repEffect: 0,  notes: '+5 fortification on owned district (max 20)' },
    { type: 'sabotage',             energyCost: 4,    creditCost: 15, influenceCost: 5, repEffect: -5, notes: 'Requires influence >= 5; -50% production on target for 2 ticks' },
    { type: 'leak_scandal',         energyCost: 2,    creditCost: 10, influenceCost: 5, repEffect: -3, notes: 'Requires influence >= 5; -8 rep on target' },
    { type: 'counter_intelligence', energyCost: 3,    creditCost: 0,  influenceCost: 5, repEffect: 0,  notes: 'Requires intelligence >= 10; nullifies covert actions against you this tick' },
    { type: 'lobby',                energyCost: 0,    creditCost: 10, influenceCost: 0, repEffect: 0,  notes: 'Free action: 10C = 1 vote toward next law; include multiple in freeActions' },
    { type: 'message',              energyCost: 0,    creditCost: 0,  influenceCost: 0, repEffect: 0,  notes: 'Free action: send message to another corp' },
    { type: 'propose_alliance',     energyCost: 0,    creditCost: 0,  influenceCost: 0, repEffect: 0,  notes: 'Free action: propose alliance' },
    { type: 'break_alliance',       energyCost: 0,    creditCost: 0,  influenceCost: 0, repEffect: -10, notes: 'Free action: break an active alliance (-10 rep)' },
    { type: 'trade',                energyCost: 0,    creditCost: 2,  influenceCost: 0, repEffect: 0,  notes: 'Free action: trade resources (2C fee per party; allies exempt)' },
    { type: 'embargo',              energyCost: 0,    creditCost: 0,  influenceCost: 0, repEffect: 0,  notes: 'Free action: block trades with target for 3 ticks' },
  ];
  if (isPariah) {
    actions.push({ type: 'corporate_assassination', energyCost: 8, creditCost: 15, influenceCost: 10, repEffect: 0, notes: 'Pariah only: -25 rep on target' });
  }
  return actions;
}
