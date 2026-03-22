// src/game/laws.js
// Single access point for the active law.  All game modules that need to know
// the current law effect should import getActiveLaw() from here rather than
// duplicating the SQL query.

function getActiveLaw(db, seasonId) {
  return db.prepare(
    'SELECT id, name, effect FROM laws WHERE season_id = ? AND is_active = 1 LIMIT 1'
  ).get(seasonId) || null;
}

module.exports = { getActiveLaw };
