// src/game/world.js
const crypto = require('crypto');
const { getDb } = require('../db/index');

// Simple UUID v4 implementation for CommonJS compatibility
function uuidv4() {
  return crypto.randomUUID();
}

// 24 districts with geographic adjacency matching the traced city map polygons.
const DISTRICT_NAMES = [
  'Meridian Park', 'The Sprawl',     'Harbor Front',    'Signal Flats',
  'Ashburn Alley', 'Eastport Terminal', 'Portside',     'Ember Ward',
  'Data Haven',    'Northgate Hub',  'Neon Row',        'Voltaic Fields',
  'The Fringe',    'The Canopy',     'Gridlock',        'The Undercroft',
  'Nexus Core',    'Foundry District', 'Silk Road',     'Blacksite',
  'Chrome Quarter','Capitol Hill',   'Veritas Square',  'Ironworks',
];

// Types: 4 data_center, 5 power_grid, 5 labor_zone, 5 financial_hub, 4 black_market, 1 government_quarter
const DISTRICT_TYPES = [
  'labor_zone',      'black_market',    'financial_hub',   'data_center',
  'black_market',    'financial_hub',   'labor_zone',      'power_grid',
  'data_center',     'labor_zone',      'power_grid',      'financial_hub',
  'black_market',    'power_grid',      'data_center',     'labor_zone',
  'government_quarter', 'power_grid',   'financial_hub',   'black_market',
  'data_center',     'financial_hub',   'labor_zone',      'power_grid',
];

// Geographic adjacency based on traced polygon layout
const DISTRICT_ADJACENCY = {
  'Meridian Park':    ['The Sprawl', 'Signal Flats', 'Ashburn Alley', 'Ember Ward', 'Portside'],
  'The Sprawl':       ['Harbor Front', 'Signal Flats', 'Meridian Park'],
  'Harbor Front':     ['Northgate Hub', 'Signal Flats', 'The Sprawl'],
  'Signal Flats':     ['Harbor Front', 'Northgate Hub', 'Data Haven', 'Ashburn Alley', 'Meridian Park', 'The Sprawl'],
  'Ashburn Alley':    ['Signal Flats', 'Data Haven', 'Ember Ward', 'Meridian Park'],
  'Eastport Terminal':['Portside', 'Voltaic Fields', 'The Fringe'],
  'Portside':         ['Meridian Park', 'Ember Ward', 'Neon Row', 'Voltaic Fields', 'Eastport Terminal'],
  'Ember Ward':       ['Ashburn Alley', 'Data Haven', 'Neon Row', 'Portside', 'Meridian Park'],
  'Data Haven':       ['Northgate Hub', 'Signal Flats', 'Silk Road', 'Nexus Core', 'Neon Row', 'Ember Ward', 'Ashburn Alley'],
  'Northgate Hub':    ['Harbor Front', 'Signal Flats', 'Data Haven', 'Silk Road', 'Foundry District'],
  'Neon Row':         ['Data Haven', 'Nexus Core', 'The Undercroft', 'Voltaic Fields', 'Portside', 'Ember Ward'],
  'Voltaic Fields':   ['Neon Row', 'The Undercroft', 'The Canopy', 'The Fringe', 'Portside', 'Eastport Terminal'],
  'The Fringe':       ['Gridlock', 'The Canopy', 'Voltaic Fields', 'Eastport Terminal'],
  'The Canopy':       ['Veritas Square', 'Ironworks', 'Gridlock', 'The Undercroft', 'Voltaic Fields'],
  'Gridlock':         ['Ironworks', 'Blacksite', 'The Canopy', 'The Fringe'],
  'The Undercroft':   ['Nexus Core', 'Veritas Square', 'The Canopy', 'Neon Row', 'Voltaic Fields'],
  'Nexus Core':       ['Silk Road', 'Chrome Quarter', 'Capitol Hill', 'Veritas Square', 'The Undercroft', 'Neon Row', 'Data Haven'],
  'Foundry District': ['Northgate Hub', 'Chrome Quarter', 'Capitol Hill'],
  'Silk Road':        ['Northgate Hub', 'Data Haven', 'Chrome Quarter', 'Nexus Core'],
  'Blacksite':        ['Ironworks', 'Gridlock'],
  'Chrome Quarter':   ['Foundry District', 'Silk Road', 'Nexus Core', 'Capitol Hill'],
  'Capitol Hill':     ['Foundry District', 'Chrome Quarter', 'Nexus Core', 'Veritas Square'],
  'Veritas Square':   ['Capitol Hill', 'Nexus Core', 'The Undercroft', 'Ironworks', 'The Canopy'],
  'Ironworks':        ['Veritas Square', 'The Canopy', 'Blacksite', 'Gridlock'],
};

function getGeographicNeighbors(name, allNames) {
  return (DISTRICT_ADJACENCY[name] || []).map(n => allNames.indexOf(n)).filter(i => i >= 0);
}

function createSeason(db, options = {}) {
  const conn = db || getDb();
  const id = uuidv4();
  const {
    tickIntervalMs = parseInt(process.env.TICK_INTERVAL_MS) || 300000,
    seasonLength = 200,
  } = options;
  conn.prepare(`
    INSERT INTO seasons (id, status, tick_interval_ms, season_length)
    VALUES (?, 'pending', ?, ?)
  `).run(id, tickIntervalMs, seasonLength);
  createLaws(conn, id);
  return id;
}

const LAWS = [
  { name: 'Data Sovereignty Act',       effect: 'data_center_bonus' },
  { name: 'Labor Protection Bill',      effect: 'labor_zone_attack_cost' },
  { name: 'Free Market Decree',         effect: 'free_trade' },
  { name: 'Crackdown Order',            effect: 'crackdown' },
  { name: 'Corporate Transparency Act', effect: 'transparency' },
  { name: 'Infrastructure Investment',  effect: 'fortify_discount' },
  { name: 'Security Lockdown',          effect: 'security_lockdown' },
  { name: 'Open Borders',               effect: 'open_borders' },
];

function createLaws(db, seasonId) {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO laws (id, season_id, name, effect) VALUES (?, ?, ?, ?)'
  );
  db.transaction(() => {
    for (const law of LAWS) {
      stmt.run(crypto.randomUUID(), seasonId, law.name, law.effect);
    }
  })();
}

function createDistrictMap(db, seasonId) {
  const conn = db || getDb();
  const ids = DISTRICT_NAMES.map(() => uuidv4());

  const insert = conn.prepare(`
    INSERT INTO districts (id, season_id, name, type, adjacent_ids)
    VALUES (?, ?, ?, ?, ?)
  `);

  conn.transaction(() => {
    for (let i = 0; i < 24; i++) {
      const neighborIds = getGeographicNeighbors(DISTRICT_NAMES[i], DISTRICT_NAMES).map(ni => ids[ni]);
      insert.run(ids[i], seasonId, DISTRICT_NAMES[i], DISTRICT_TYPES[i], JSON.stringify(neighborIds));
    }
  })();

  return ids;
}

module.exports = { createSeason, createDistrictMap, createLaws, LAWS };
