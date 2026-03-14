// src/game/tick.js
const crypto = require('crypto');
const { getDb } = require('../db/index');
const { generateResources } = require('./resources');
const { calculateValuation } = require('./valuation');
const { resolveActions } = require('./actions/resolve');

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
    WHERE (corp_a_id = ? OR corp_b_id = ?) AND broken_tick IS NULL
  `).all(corp.id, corp.id, corp.id, corp.id);

  const recentEvents = db.prepare(
    'SELECT narrative FROM events WHERE season_id = ? AND tick >= ? ORDER BY tick DESC LIMIT 10'
  ).all(corp.season_id, Math.max(0, season.tick_count - 3)).map(e => e.narrative);

  const messages = db.prepare(
    'SELECT from_corp_id, text FROM messages WHERE to_corp_id = ? AND delivered_tick = ?'
  ).all(corp.id, season.tick_count);

  const headlines = db.prepare(
    "SELECT narrative FROM events WHERE season_id = ? AND type = 'headline' AND tick = ?"
  ).all(corp.season_id, season.tick_count).map(e => e.narrative);

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
    narrative: null, // TODO Plan 4
  };
}

function runTick(db, seasonId) {
  const conn = db || getDb();
  const season = conn.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season || season.status !== 'active') return;

  // Step 1: Increment tick and set is_ticking flag
  // is_ticking = 1 signals to GET /briefing that generation is in progress
  const newTick = season.tick_count + 1;
  conn.prepare('UPDATE seasons SET tick_count = ?, is_ticking = 1 WHERE id = ?').run(newTick, seasonId);
  const updatedSeason = { ...season, tick_count: newTick };

  // Step 2: Resource generation (includes Workforce enforcement)
  generateResources(conn, seasonId, newTick);

  // Steps 3-7: Action resolution — resolve actions submitted during the tick that just ended
  resolveActions(conn, seasonId, newTick - 1);

  // Step 8: Store briefings for all corps
  const corps = conn.prepare('SELECT * FROM corporations WHERE season_id = ?').all(seasonId);

  conn.transaction(() => {
    for (const corp of corps) {
      const payload = buildBriefingPayload(conn, corp, updatedSeason);
      // INSERT OR REPLACE on UNIQUE(corp_id, tick): deletes old row then inserts new.
      conn.prepare(`
        INSERT OR REPLACE INTO briefings (id, corp_id, tick, payload)
        VALUES (?, ?, ?, ?)
      `).run(crypto.randomUUID(), corp.id, newTick, JSON.stringify(payload));
    }
  })();

  // Clear is_ticking flag — briefings are now ready
  conn.prepare('UPDATE seasons SET is_ticking = 0 WHERE id = ?').run(seasonId);

  console.log(`[tick ${newTick}] ${corps.length} corps updated`);
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

  _interval = setInterval(() => {
    const s = conn.prepare(
      "SELECT id, tick_interval_ms FROM seasons WHERE status = 'active' LIMIT 1"
    ).get();
    if (!s) return; // no active season yet — keep polling

    const now = Date.now();
    if (now - _lastTick.time >= s.tick_interval_ms) {
      _lastTick.time = now;
      runTick(conn, s.id);
    }
  }, 5000); // poll every 5 seconds

  console.log('Tick loop started — polling every 5s for active season');
  return _interval;
}

function stopTickLoop() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = { runTick, startTickLoop, stopTickLoop };
