// src/db/schema.js
const { getDb } = require('./index');

function initDb(db) {
  const conn = db || getDb();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS seasons (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      tick_interval_ms INTEGER NOT NULL DEFAULT 300000,
      tick_count INTEGER NOT NULL DEFAULT 0,
      season_length INTEGER NOT NULL DEFAULT 200,
      scoring_weights TEXT NOT NULL DEFAULT '{}',
      is_ticking INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS districts (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      owner_id TEXT,
      fortification_level INTEGER NOT NULL DEFAULT 0,
      adjacent_ids TEXT NOT NULL DEFAULT '[]',
      sabotaged_until INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (season_id) REFERENCES seasons(id)
    );

    CREATE TABLE IF NOT EXISTS corporations (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL UNIQUE,
      reputation INTEGER NOT NULL DEFAULT 50,
      credits INTEGER NOT NULL DEFAULT 10,
      energy INTEGER NOT NULL DEFAULT 8,
      workforce INTEGER NOT NULL DEFAULT 6,
      intelligence INTEGER NOT NULL DEFAULT 4,
      influence INTEGER NOT NULL DEFAULT 0,
      political_power INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (season_id) REFERENCES seasons(id)
    );

    CREATE TABLE IF NOT EXISTS alliances (
      id TEXT PRIMARY KEY,
      corp_a_id TEXT NOT NULL,
      corp_b_id TEXT NOT NULL,
      formed_tick INTEGER NOT NULL,
      broken_tick INTEGER,
      broken_by_corp_id TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      type TEXT NOT NULL,
      involved_corp_ids TEXT NOT NULL DEFAULT '[]',
      involved_district_ids TEXT NOT NULL DEFAULT '[]',
      details TEXT NOT NULL DEFAULT '{}',
      narrative TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (season_id) REFERENCES seasons(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_corp_id TEXT NOT NULL,
      to_corp_id TEXT NOT NULL,
      text TEXT NOT NULL,
      delivered_tick INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS phases (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      phase_number INTEGER NOT NULL,
      start_tick INTEGER NOT NULL,
      end_tick INTEGER,
      resolved_law_id TEXT,
      FOREIGN KEY (season_id) REFERENCES seasons(id)
    );

    CREATE TABLE IF NOT EXISTS laws (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      name TEXT NOT NULL,
      effect TEXT NOT NULL,
      active_since INTEGER,
      is_active INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (season_id) REFERENCES seasons(id)
    );

    CREATE TABLE IF NOT EXISTS lobby_votes (
      id TEXT PRIMARY KEY,
      phase_id TEXT NOT NULL,
      corp_id TEXT NOT NULL,
      credits INTEGER NOT NULL,
      FOREIGN KEY (phase_id) REFERENCES phases(id)
    );

    CREATE TABLE IF NOT EXISTS pending_actions (
      id TEXT PRIMARY KEY,
      corp_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      raw_response TEXT,
      parsed_actions TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(corp_id, tick)
    );

    CREATE TABLE IF NOT EXISTS briefings (
      id TEXT PRIMARY KEY,
      corp_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(corp_id, tick)
    );
  `);
  conn.pragma('foreign_keys = ON');
}

module.exports = { initDb };
