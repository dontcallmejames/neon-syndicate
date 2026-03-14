function adminAuth(req, res, next) {
  const key = process.env.ADMIN_KEY;
  if (!key) return res.status(503).json({ error: 'Admin interface disabled (ADMIN_KEY not set)' });
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${key}`) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

module.exports = adminAuth;
