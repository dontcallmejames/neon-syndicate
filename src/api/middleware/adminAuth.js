const crypto = require('crypto');

function adminAuth(req, res, next) {
  const key = process.env.ADMIN_KEY;
  if (!key) return res.status(503).json({ error: 'Admin interface disabled (ADMIN_KEY not set)' });
  const auth = req.headers['authorization'] || '';
  const expected = `Bearer ${key}`;
  const authBuf = Buffer.from(auth);
  const expectedBuf = Buffer.from(expected);
  if (authBuf.byteLength !== expectedBuf.byteLength ||
      !crypto.timingSafeEqual(authBuf, expectedBuf)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = adminAuth;
