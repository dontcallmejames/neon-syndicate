const adminAuth = require('../../../src/api/middleware/adminAuth');

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

afterEach(() => { delete process.env.ADMIN_KEY; });

test('returns 503 when ADMIN_KEY env var is not set', () => {
  delete process.env.ADMIN_KEY;
  const req = { headers: {} };
  const res = makeRes();
  const next = jest.fn();
  adminAuth(req, res, next);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('ADMIN_KEY') }));
  expect(next).not.toHaveBeenCalled();
});

test('returns 401 when Authorization header is missing', () => {
  process.env.ADMIN_KEY = 'secret';
  const req = { headers: {} };
  const res = makeRes();
  const next = jest.fn();
  adminAuth(req, res, next);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
});

test('returns 401 when Authorization header has wrong key', () => {
  process.env.ADMIN_KEY = 'secret';
  const req = { headers: { authorization: 'Bearer wrongkey' } };
  const res = makeRes();
  const next = jest.fn();
  adminAuth(req, res, next);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
});

test('calls next() when Authorization header is correct', () => {
  process.env.ADMIN_KEY = 'secret';
  const req = { headers: { authorization: 'Bearer secret' } };
  const res = makeRes();
  const next = jest.fn();
  adminAuth(req, res, next);
  expect(next).toHaveBeenCalled();
  expect(res.status).not.toHaveBeenCalled();
});
