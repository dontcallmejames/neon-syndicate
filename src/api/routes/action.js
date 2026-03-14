// src/api/routes/action.js
// Note: UNIQUE(corp_id, tick) on pending_actions enforces the one-submission-per-tick rule.
// INSERT OR REPLACE handles the overwrite case atomically.

module.exports = function actionRoute(db) {
  return (req, res) => {
    const { agentId } = req.params;
    if (req.corp.id !== agentId) {
      return res.status(403).json({ error: 'cannot submit action for another corp' });
    }

    const corp = req.corp;
    const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(corp.season_id);
    if (!season || season.status !== 'active') {
      return res.status(403).json({ error: 'no active season' });
    }

    const { response, actions } = req.body;
    if (!response && !actions) {
      return res.status(400).json({ error: 'provide either response (string) or actions (object)' });
    }

    const id = require('crypto').randomUUID();
    const currentTick = season.tick_count;

    // INSERT OR REPLACE relies on UNIQUE(corp_id, tick) in the schema
    db.prepare(`
      INSERT OR REPLACE INTO pending_actions (id, corp_id, tick, raw_response, parsed_actions, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(
      id,
      corp.id,
      currentTick,
      response || null,
      actions ? JSON.stringify(actions) : null,
    );

    return res.json({ received: true, tick: currentTick });
  };
};
