// src/game/worldState.js
// Shared world-state builder used by both the /world route (HTTP poll) and
// the tick loop (WebSocket broadcast). Returns the core structure — callers
// wrap it with their own envelope fields (type, status, nextTickAt, etc.).

const { calculateValuation } = require('./valuation');
const { getActiveLaw } = require('./laws');
const { getReputationLabel } = require('./reputation');

function buildWorldState(db, seasonId, tick, { headlines: providedHeadlines } = {}) {
  const districts = db.prepare(`
    SELECT d.id, d.name, d.type, d.owner_id, c.name AS owner_name,
           d.fortification_level, d.adjacent_ids
    FROM districts d LEFT JOIN corporations c ON c.id = d.owner_id
    WHERE d.season_id = ?
  `).all(seasonId);

  const corps = db.prepare(`
    SELECT id, name, reputation, credits, energy, workforce,
           intelligence, influence, political_power
    FROM corporations WHERE season_id = ? ORDER BY rowid ASC
  `).all(seasonId);

  const corporations = corps.map(c => {
    const districtCount = districts.filter(d => d.owner_id === c.id).length;
    return {
      id: c.id,
      name: c.name,
      valuation: calculateValuation(c, districtCount),
      reputation: c.reputation,
      reputationLabel: getReputationLabel(c.reputation),
      districtCount,
    };
  });

  const alliances = db.prepare(`
    SELECT a.corp_a_id, a.corp_b_id, ca.name AS corp_a_name, cb.name AS corp_b_name
    FROM alliances a
    JOIN corporations ca ON ca.id = a.corp_a_id
    JOIN corporations cb ON cb.id = a.corp_b_id
    WHERE ca.season_id = ? AND cb.season_id = ?
      AND a.formed_tick IS NOT NULL AND a.broken_tick IS NULL
  `).all(seasonId, seasonId);

  const activeLaw = getActiveLaw(db, seasonId);

  let headlines;
  if (providedHeadlines !== undefined) {
    // Caller supplies in-memory headlines (tick loop — avoids re-querying what was just written)
    headlines = Array.isArray(providedHeadlines)
      ? providedHeadlines.filter(h => h.trim() !== '')
      : [];
  } else {
    const headlineEvent = db.prepare(
      "SELECT narrative FROM events WHERE season_id = ? AND type = 'headline' ORDER BY tick DESC LIMIT 1"
    ).get(seasonId);
    headlines = headlineEvent
      ? headlineEvent.narrative.split('\n').filter(h => h.trim() !== '')
      : [];
  }

  return {
    tick,
    districts: districts.map(d => ({
      id: d.id,
      name: d.name,
      type: d.type,
      ownerId: d.owner_id,
      ownerName: d.owner_name,
      fortificationLevel: d.fortification_level,
      adjacentIds: (() => { try { return JSON.parse(d.adjacent_ids); } catch { return []; } })(),
    })),
    corporations,
    alliances: alliances.map(a => ({
      corpAId: a.corp_a_id,
      corpBId: a.corp_b_id,
      corpAName: a.corp_a_name,
      corpBName: a.corp_b_name,
    })),
    activeLaw: activeLaw || null,
    headlines,
  };
}

module.exports = { buildWorldState };
