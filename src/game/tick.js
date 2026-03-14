// src/game/tick.js
const crypto = require('crypto');
const { getDb } = require('../db/index');
const { generateResources } = require('./resources');
const { calculateValuation } = require('./valuation');
const { resolveActions } = require('./actions/resolve');
const { parseNLAction, generateNarratives, generateHeadlines, buildFallbackNarrative } = require('./gemini');
const { buildAvailableActions } = require('../api/routes/briefing');
const { writeEvent } = require('./events');
const { broadcast } = require('../api/ws');

function buildBriefingPayload(db, corp, season) {
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
  ).all(corp.season_id, Math.max(0, season.tick_count - 3)).map(e => e.narrative);

  const messages = db.prepare(
    'SELECT from_corp_id, text FROM messages WHERE to_corp_id = ? AND delivered_tick = ?'
  ).all(corp.id, season.tick_count);

  const headlines = db.prepare(
    "SELECT narrative FROM events WHERE season_id = ? AND type = 'headline' AND tick = ?"
  ).all(corp.season_id, season.tick_count).flatMap(e => e.narrative.split('\n'));

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

  return {
    tick: season.tick_count,
    generating: false,
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
    activeLaw: activeLaw || null,
    availableActions: [],
    narrative: null,
  };
}

async function runTick(db, seasonId) {
  const conn = db || getDb();
  const season = conn.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season || season.status !== 'active') return;

  // Step 1: Increment tick and set is_ticking flag
  // is_ticking = 1 signals to GET /briefing that generation is in progress
  const newTick = season.tick_count + 1;
  conn.prepare('UPDATE seasons SET tick_count = ?, is_ticking = 1 WHERE id = ?').run(newTick, seasonId);
  const updatedSeason = { ...season, tick_count: newTick };

  try {
    // Step 2: Resource generation (includes Workforce enforcement)
    generateResources(conn, seasonId, newTick);

    // Step 3: Parse NL submissions for tick that just ended (newTick - 1)
    const pendingNLActions = conn.prepare(`
      SELECT pa.*, c.reputation, c.credits, c.energy, c.workforce, c.intelligence, c.influence, c.political_power, c.name AS corp_name
      FROM pending_actions pa
      JOIN corporations c ON c.id = pa.corp_id
      WHERE pa.tick = ? AND pa.raw_response IS NOT NULL
        AND pa.parsed_actions IS NULL AND pa.status = 'pending'
    `).all(newTick - 1);

    for (const row of pendingNLActions) {
      const corp = {
        id: row.corp_id,
        name: row.corp_name,
        reputation: row.reputation,
        credits: row.credits,
        energy: row.energy,
        workforce: row.workforce,
        intelligence: row.intelligence,
        influence: row.influence,
        political_power: row.political_power,
      };
      const availableActions = buildAvailableActions(corp.reputation < 15);
      const result = await parseNLAction(row.raw_response, availableActions, corp);
      if (result !== null) {
        conn.prepare('UPDATE pending_actions SET parsed_actions = ? WHERE id = ?')
          .run(JSON.stringify(result), row.id);
      } else {
        conn.prepare("UPDATE pending_actions SET status = 'rejected' WHERE id = ?")
          .run(row.id);
      }
    }

    // Step 4: Action resolution — resolve actions submitted during the tick that just ended
    resolveActions(conn, seasonId, newTick - 1);

    // Step 5: Build briefing payloads for all corps
    const corps = conn.prepare('SELECT * FROM corporations WHERE season_id = ?').all(seasonId);
    const corpPayloadPairs = corps.map(corp => ({
      corp,
      payload: buildBriefingPayload(conn, corp, updatedSeason),
    }));

    // Step 6: Generate narratives via Gemini
    const narratives = await generateNarratives(corpPayloadPairs);
    for (const { corp, payload } of corpPayloadPairs) {
      payload.narrative = narratives[corp.id] ?? buildFallbackNarrative(corp, payload);
    }

    // Step 7: INSERT OR REPLACE briefings into DB
    conn.transaction(() => {
      for (const { corp, payload } of corpPayloadPairs) {
        // INSERT OR REPLACE on UNIQUE(corp_id, tick): deletes old row then inserts new.
        conn.prepare(`
          INSERT OR REPLACE INTO briefings (id, corp_id, tick, payload)
          VALUES (?, ?, ?, ?)
        `).run(crypto.randomUUID(), corp.id, newTick, JSON.stringify(payload));
      }
    })();

    // Step 8: Generate and write headlines
    const events = conn.prepare(
      'SELECT * FROM events WHERE season_id = ? AND tick = ?'
    ).all(seasonId, newTick - 1);
    const headlines = await generateHeadlines(events, newTick);
    writeEvent(conn, { seasonId, tick: newTick, type: 'headline', narrative: headlines.join('\n') });

    // Step 13: Broadcast tick_complete to WebSocket dashboard clients
    const broadcastDistricts = conn.prepare(`
      SELECT d.id, d.name, d.type, d.owner_id, c.name AS owner_name, d.fortification_level, d.adjacent_ids
      FROM districts d LEFT JOIN corporations c ON c.id = d.owner_id
      WHERE d.season_id = ?
    `).all(seasonId);

    const broadcastCorps = conn.prepare(`
      SELECT id, name, reputation, credits, energy, workforce,
             intelligence, influence, political_power
      FROM corporations WHERE season_id = ? ORDER BY rowid ASC
    `).all(seasonId).map(c => {
      const districtCount = broadcastDistricts.filter(d => d.owner_id === c.id).length;
      return {
        id: c.id,
        name: c.name,
        valuation: calculateValuation(c, districtCount),
        reputation: c.reputation,
        reputationLabel:
          c.reputation >= 75 ? 'Trusted' :
          c.reputation >= 40 ? 'Neutral' :
          c.reputation >= 15 ? 'Notorious' : 'Pariah',
        districtCount,
      };
    });

    const broadcastAlliances = conn.prepare(`
      SELECT a.corp_a_id, a.corp_b_id, ca.name AS corp_a_name, cb.name AS corp_b_name
      FROM alliances a
      JOIN corporations ca ON ca.id = a.corp_a_id
      JOIN corporations cb ON cb.id = a.corp_b_id
      WHERE ca.season_id = ? AND cb.season_id = ?
        AND a.formed_tick IS NOT NULL AND a.broken_tick IS NULL
    `).all(seasonId, seasonId);

    const broadcastLaw = conn.prepare(
      'SELECT name, effect FROM laws WHERE season_id = ? AND is_active = 1'
    ).get(seasonId);

    // Use the in-memory headlines array rather than re-querying what we just wrote
    const broadcastHeadlines = Array.isArray(headlines) ? headlines.filter(h => h.trim() !== '') : [];

    broadcast({
      type: 'tick_complete',
      tick: newTick,
      districts: broadcastDistricts.map(d => ({
        id: d.id,
        name: d.name,
        type: d.type,
        ownerId: d.owner_id,
        ownerName: d.owner_name,
        fortificationLevel: d.fortification_level,
        adjacentIds: (() => { try { return JSON.parse(d.adjacent_ids); } catch { return []; } })(),
      })),
      corporations: broadcastCorps,
      alliances: broadcastAlliances.map(a => ({
        corpAId: a.corp_a_id,
        corpBId: a.corp_b_id,
        corpAName: a.corp_a_name,
        corpBName: a.corp_b_name,
      })),
      activeLaw: broadcastLaw || null,
      headlines: broadcastHeadlines,
    });

    console.log(`[tick ${newTick}] ${corps.length} corps updated`);
  } finally {
    // Step 9: Clear is_ticking flag — briefings are now ready (always runs, even on error)
    conn.prepare('UPDATE seasons SET is_ticking = 0 WHERE id = ?').run(seasonId);
  }
}

let _interval = null;
const _lastTick = { time: 0 };

// The tick loop polls every 5 seconds and fires a tick when enough time has
// passed per the active season's tick_interval_ms. This means the interval is
// always read fresh — no restart needed when a season is activated or its
// interval is changed mid-season.
function startTickLoop(db) {
  const conn = db || getDb();
  if (_interval) clearInterval(_interval);
  _lastTick.time = Date.now();

  _interval = setInterval(async () => {
    try {
      const s = conn.prepare(
        "SELECT id, tick_interval_ms FROM seasons WHERE status = 'active' LIMIT 1"
      ).get();
      if (!s) return;

      const now = Date.now();
      if (now - _lastTick.time >= s.tick_interval_ms) {
        _lastTick.time = now;
        await runTick(conn, s.id);
      }
    } catch (err) {
      console.error('[tick] Unexpected error in tick loop:', err);
    }
  }, 5000);

  console.log('Tick loop started — polling every 5s for active season');
  return _interval;
}

function stopTickLoop() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = { runTick, startTickLoop, stopTickLoop };
