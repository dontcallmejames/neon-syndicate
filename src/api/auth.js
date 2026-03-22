// src/api/auth.js
const crypto = require('crypto');
const { getDb } = require('../db/index');

function hashKey(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function requireAuth(db) {
  return (req, res, next) => {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'missing token' });

    const conn = db || getDb();
    const corp = conn.prepare('SELECT * FROM corporations WHERE api_key = ?').get(hashKey(token));
    if (!corp) return res.status(401).json({ error: 'invalid token' });

    req.corp = corp;
    next();
  };
}

module.exports = { requireAuth };
