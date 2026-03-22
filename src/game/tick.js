// src/game/tick.js
const crypto = require('crypto');
const { getDb } = require('../db/index');
const { generateResources } = require('./resources');
const { resolveActions } = require('./actions/resolve');
const { parseNLAction, generateNarratives, generateHeadlines, buildFallbackNarrative } = require('./gemini');
const { buildAvailableActions } = require('./actions/available');
const { writeEvent } = require('./events');
const { broadcast } = require('../api/ws');
const { PARIAH_THRESHOLD } = require('./reputation');
const { buildBriefingPayload } = require('./briefing');
const { buildWorldState } = require('./worldState');
const logger = require('../lib/logger');

// ─── Tick step helpers ────────────────────────────────────────────────────────

// Step 3: Parse any raw NL action submissions that arrived during the previous tick.
async function parseNLSubmissions(conn, tick) {
  const pendingNLActions = conn.prepare(`
    SELECT pa.*, c.reputation, c.credits, c.energy, c.workforce, c.intelligence, c.influence, c.political_power, c.name AS corp_name
    FROM pending_actions pa
    JOIN corporations c ON c.id = pa.corp_id
    WHERE pa.tick = ? AND pa.raw_response IS NOT NULL
      AND pa.parsed_actions IS NULL AND pa.status = 'pending'
  `).all(tick);

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
    const availableActions = buildAvailableActions(corp.reputation < PARIAH_THRESHOLD);
    const result = await parseNLAction(row.raw_response, availableActions, corp);
    if (result !== null) {
      conn.prepare('UPDATE pending_actions SET parsed_actions = ? WHERE id = ?')
        .run(JSON.stringify(result), row.id);
    } else {
      conn.prepare("UPDATE pending_actions SET status = 'rejected' WHERE id = ?")
        .run(row.id);
    }
  }
}

// Steps 5–7: Build briefing payloads, generate Gemini narratives (with fallback),
// and persist them to the briefings table. Returns the number of corps processed.
async function buildAndStoreBriefings(conn, seasonId, newTick, season) {
  const corps = conn.prepare('SELECT * FROM corporations WHERE season_id = ?').all(seasonId);
  const corpPayloadPairs = corps.map(corp => ({
    corp,
    payload: buildBriefingPayload(conn, corp, season),
  }));

  let narratives = {};
  try {
    narratives = await generateNarratives(corpPayloadPairs);
  } catch (err) {
    logger.warn('tick', 'generateNarratives error (non-fatal)', { err: err.message });
  }
  for (const { corp, payload } of corpPayloadPairs) {
    payload.narrative = narratives[corp.id] ?? buildFallbackNarrative(corp, payload);
  }

  conn.transaction(() => {
    for (const { corp, payload } of corpPayloadPairs) {
      conn.prepare(`
        INSERT OR REPLACE INTO briefings (id, corp_id, tick, payload)
        VALUES (?, ?, ?, ?)
      `).run(crypto.randomUUID(), corp.id, newTick, JSON.stringify(payload));
    }
  })();

  return corps.length;
}

// Step 8: Generate Gemini headlines from the previous tick's events, write them
// as a headline event for newTick, and return the array for the WS broadcast.
async function generateAndWriteHeadlines(conn, seasonId, newTick) {
  const events = conn.prepare(
    'SELECT * FROM events WHERE season_id = ? AND tick = ?'
  ).all(seasonId, newTick - 1);

  // Build world context so headlines can name corps, districts, and active law
  const topCorps = conn.prepare(`
    SELECT c.name, COUNT(d.id) AS district_count
    FROM corporations c
    LEFT JOIN districts d ON d.owner_id = c.id AND d.season_id = c.season_id
    WHERE c.season_id = ?
    GROUP BY c.id ORDER BY district_count DESC LIMIT 5
  `).all(seasonId).map(r => ({ name: r.name, districtCount: r.district_count }));

  const activeLawRow = conn.prepare(
    "SELECT name FROM laws WHERE season_id = ? AND is_active = 1 LIMIT 1"
  ).get(seasonId);

  const worldContext = { topCorps, activeLaw: activeLawRow?.name ?? null };

  try {
    const headlines = await generateHeadlines(events, newTick, worldContext);
    writeEvent(conn, { seasonId, tick: newTick, type: 'headline', narrative: headlines.join('\n') });
    return headlines;
  } catch (err) {
    logger.warn('tick', 'generateHeadlines error (non-fatal)', { err: err.message });
    return [];
  }
}

// ─── Main tick orchestrator ───────────────────────────────────────────────────

async function runTick(db, seasonId) {
  const conn = db || getDb();
  const season = conn.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season || season.status !== 'active') return;

  // Step 1: Check season end
  const newTick = season.tick_count + 1;
  if (newTick > season.season_length) {
    conn.prepare("UPDATE seasons SET status = 'ended' WHERE id = ?").run(seasonId);
    logger.info('tick', 'season ended', { seasonId, ticks: season.season_length });
    return;
  }

  // Step 2: Advance tick counter; is_ticking signals briefing route that generation is in progress
  const tickStart = Date.now();
  conn.prepare('UPDATE seasons SET tick_count = ?, is_ticking = 1, last_tick_at = ? WHERE id = ?')
    .run(newTick, tickStart, seasonId);
  const updatedSeason = { ...season, tick_count: newTick };

  try {
    // Step 3: Generate resources for the new tick
    generateResources(conn, seasonId, newTick);

    // Step 4: Parse any NL action submissions from the previous tick
    await parseNLSubmissions(conn, newTick - 1);

    // Step 5: Resolve all actions from the previous tick
    resolveActions(conn, seasonId, newTick - 1);

    // Steps 6–8: Build briefings (with Gemini narratives) + generate headlines
    const [corpCount, headlines] = await Promise.all([
      buildAndStoreBriefings(conn, seasonId, newTick, updatedSeason),
      generateAndWriteHeadlines(conn, seasonId, newTick),
    ]);

    // Step 9: Broadcast updated world state to WebSocket clients
    try {
      const state = buildWorldState(conn, seasonId, newTick, { headlines });
      broadcast({ type: 'tick_complete', nextTickAt: Date.now() + season.tick_interval_ms, ...state });
    } catch (err) {
      logger.warn('tick', 'broadcast error (non-fatal)', { err: err.message });
    }

    logger.info('tick', 'tick complete', { tick: newTick, corps: corpCount, ms: Date.now() - tickStart });
  } finally {
    // Always clear is_ticking — briefings are now ready (or generation failed)
    conn.prepare('UPDATE seasons SET is_ticking = 0 WHERE id = ?').run(seasonId);
  }
}

// ─── Tick loop ────────────────────────────────────────────────────────────────

let _interval = null;
const _lastTick = { time: 0 };
let _running = false;

// Polls every 5 seconds and fires a tick when enough time has passed per the
// active season's tick_interval_ms. The interval is read fresh each poll, so
// no restart is needed when a season is activated or its interval changes.
function startTickLoop(db) {
  const conn = db || getDb();
  conn.prepare('UPDATE seasons SET is_ticking = 0 WHERE is_ticking = 1').run();
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
        if (_running) return;
        _running = true;
        try {
          await runTick(conn, s.id);
        } finally {
          _running = false;
        }
      }
    } catch (err) {
      logger.error('tick', 'unexpected error in tick loop', { err: err.message, stack: err.stack });
    }
  }, 5000);

  logger.info('tick', 'tick loop started', { pollIntervalMs: 5000 });
  return _interval;
}

function stopTickLoop() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

async function runTickNow(db, seasonId) {
  return runTick(db, seasonId);
}

module.exports = { runTick, startTickLoop, stopTickLoop, runTickNow };
