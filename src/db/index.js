// src/db/index.js
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../neon.db');
let _db;

function getDb() {
  if (!_db) _db = new Database(dbPath);
  return _db;
}

function closeDb() {
  if (_db) { _db.close(); _db = null; }
}

module.exports = { getDb, closeDb };
