// src/api/routes/briefing.js
const { buildFallbackNarrative } = require('../../game/gemini');
const { buildBriefingPayload } = require('../../game/briefing');
const logger = require('../../lib/logger');

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
      try {
        const payload = JSON.parse(stored.payload);
        payload.nextTickAt = (season.last_tick_at || 0) + (season.tick_interval_ms || 0);
        return res.json(payload);
      } catch (err) {
        logger.warn('briefing', 'failed to parse stored payload, falling through to live build', { err: err.message });
      }
    }

    // Build live briefing from current DB state
    const payload = buildBriefingPayload(db, corp, season);
    payload.generating = isGenerating;
    payload.narrative = buildFallbackNarrative(corp, payload);

    return res.json(payload);
  };
};

module.exports = briefingRoute;
