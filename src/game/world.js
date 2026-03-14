// src/game/world.js
const crypto = require('crypto');
const { getDb } = require('../db/index');

// Simple UUID v4 implementation for CommonJS compatibility
function uuidv4() {
  return crypto.randomUUID();
}

// 24 districts arranged in a 6x4 grid. Adjacency = left/right/up/down (no diagonals).
const GRID_COLS = 6;
const GRID_ROWS = 4;

const DISTRICT_NAMES = [
  'Northgate', 'Chrome Quarter', 'Data Row', 'Midtown', 'Neon Strip', 'East Docks',
  'The Sprawl', 'Ironworks', 'Government Hill', 'Shadowmarket', 'Westside', 'Harbor Gate',
  'Undervault', 'Power Station Alpha', 'Labor Yards', 'Synapse Hub', 'Old Town', 'Redline',
  'Blacksite', 'The Exchange', 'Southgate', 'Circuit Row', 'Power Station Beta', 'Deep Market',
];

// 24 types matching spec: 4 data_center, 5 power_grid, 5 labor_zone,
// 5 financial_hub, 4 black_market, 1 government_quarter
const DISTRICT_TYPES = [
  'data_center',       'power_grid',    'labor_zone',    'financial_hub', 'black_market',    'government_quarter',
  'data_center',       'power_grid',    'labor_zone',    'financial_hub', 'black_market',    'power_grid',
  'labor_zone',        'financial_hub', 'black_market',  'data_center',   'power_grid',      'labor_zone',
  'financial_hub',     'black_market',  'data_center',   'power_grid',    'labor_zone',      'financial_hub',
];

function getGridNeighbors(index) {
  const row = Math.floor(index / GRID_COLS);
  const col = index % GRID_COLS;
  const neighbors = [];
  if (col > 0) neighbors.push(index - 1);
  if (col < GRID_COLS - 1) neighbors.push(index + 1);
  if (row > 0) neighbors.push(index - GRID_COLS);
  if (row < GRID_ROWS - 1) neighbors.push(index + GRID_COLS);
  return neighbors;
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
  return id;
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
      const neighborIds = getGridNeighbors(i).map(ni => ids[ni]);
      insert.run(ids[i], seasonId, DISTRICT_NAMES[i], DISTRICT_TYPES[i], JSON.stringify(neighborIds));
    }
  })();

  return ids;
}

module.exports = { createSeason, createDistrictMap };
