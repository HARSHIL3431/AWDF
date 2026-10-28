import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../src/middleware/rateLimiter.js';
import { FORGOT_PASSWORD_RATE_LIMIT } from '../src/config/jobConfig.js';
import authRoutes from '../src/routes/authRoutes.js';

function fakeRes() {
  const res = {
    statusCode: null,
    body: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
  };
  return res;
}

function makeReq(remoteAddress = '10.0.0.1', headers = {}) {
  return { socket: { remoteAddress }, headers };
}

test('approved limits: 5 requests per 15 minutes per IP', () => {
  assert.equal(FORGOT_PASSWORD_RATE_LIMIT.max, 5);
  assert.equal(FORGOT_PASSWORD_RATE_LIMIT.windowMs, 15 * 60_000);
});

test('requests below the limit pass; the 6th is rejected with 429', () => {
  let clock = 1_000_000;
  const limiter = createRateLimiter({ max: 5, windowMs: 15 * 60_000, now: () => clock });

  let passed = 0;
  const next = () => {
    passed += 1;
  };

  for (let i = 0; i < 5; i += 1) {
    const res = fakeRes();
    limiter(makeReq(), res, next);
    assert.equal(res.statusCode, null, `request ${i + 1} must pass`);
  }
  assert.equal(passed, 5);

  const res = fakeRes();
  limiter(makeReq(), res, next);
  assert.equal(passed, 5, 'handler not invoked once limited');
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: 'Too many requests. Please try again later.' });
  assert.ok(Number(res.headers['Retry-After']) >= 1, 'Retry-After header present');
});

test('the rate-limit window expires and the client may proceed again', () => {
  let clock = 5_000_000;
  const windowMs = 1_000;
  const limiter = createRateLimiter({ max: 2, windowMs, now: () => clock });
  const next = () => {};

  limiter(makeReq(), fakeRes(), next);
  limiter(makeReq(), fakeRes(), next);
  const blocked = fakeRes();
  limiter(makeReq(), blocked, next);
  assert.equal(blocked.statusCode, 429);

  // Advance past the window: oldest entries fall out, client passes again.
  clock += windowMs + 1;
  const after = fakeRes();
  limiter(makeReq(), after, next);
  assert.equal(after.statusCode, null, 'window expiry resets the bucket');
});

test('buckets are keyed by socket address, not by email or header', () => {
  let clock = 9_000_000;
  const limiter = createRateLimiter({ max: 1, windowMs: 60_000, now: () => clock });
  const next = () => {};

  limiter(makeReq('10.0.0.1'), fakeRes(), next);
  const sameIpBlocked = fakeRes();
  limiter(makeReq('10.0.0.1'), fakeRes(), next); // still same key
  limiter(makeReq('10.0.0.1'), sameIpBlocked, next);
  assert.equal(sameIpBlocked.statusCode, 429);

  // A different socket address has an independent bucket.
  const otherIp = fakeRes();
  limiter(makeReq('10.0.0.2'), otherIp, next);
  assert.equal(otherIp.statusCode, null, 'other clients unaffected');
});

test('X-Forwarded-For is ignored (spoofing does not mint new buckets)', () => {
  let clock = 11_000_000;
  const limiter = createRateLimiter({ max: 1, windowMs: 60_000, now: () => clock });
  const next = () => {};

  limiter(makeReq('172.16.0.9'), fakeRes(), next);

  // Attacker varies X-Forwarded-For on every request: still the same bucket.
  for (let i = 0; i < 3; i += 1) {
    const res = fakeRes();
    limiter(makeReq('172.16.0.9', { 'x-forwarded-for': `1.2.3.${i}` }), res, next);
    assert.equal(res.statusCode, 429, 'forwarded header must not bypass the limit');
  }
});

test('missing socket address falls back to a single conservative bucket', () => {
  let clock = 12_000_000;
  const limiter = createRateLimiter({ max: 1, windowMs: 60_000, now: () => clock });
  const next = () => {};
  const reqWithoutSocket = { headers: {} };

  limiter(reqWithoutSocket, fakeRes(), next);
  const second = fakeRes();
  limiter(reqWithoutSocket, second, next);
  assert.equal(second.statusCode, 429);
});

test('limiter validates its own configuration', () => {
  assert.throws(() => createRateLimiter({ max: 0 }), /positive integer/);
  assert.throws(() => createRateLimiter({ max: 1.5 }), /positive integer/);
  assert.throws(() => createRateLimiter({ windowMs: 0 }), /positive integer/);
});

test('limiter is mounted ONLY on POST /forgot-password (other routes untouched)', () => {
  const findRoute = (path) =>
    authRoutes.stack.find((layer) => layer.route && layer.route.path === path)?.route;

  const register = findRoute('/register');
  const login = findRoute('/login');
  const me = findRoute('/me');
  const forgot = findRoute('/forgot-password');
  const reset = findRoute('/reset-password/:token');

  assert.ok(forgot, 'forgot-password route exists');
  assert.equal(forgot.stack.length, 2, 'forgot-password has limiter + handler');

  assert.equal(register.stack.length, 1, '/register must not be rate limited');
  assert.equal(login.stack.length, 1, '/login must not be rate limited');
  assert.equal(me.stack.length, 2, '/me has authenticateToken + handler only (no limiter)');
  assert.equal(reset.stack.length, 1, '/reset-password must not be rate limited');
  assert.notEqual(
    me.stack[0].handle,
    forgot.stack[0].handle,
    '/me must not mount the forgot-password limiter'
  );
});

test('the mounted limiter on forgot-password actually rejects at 5 (integration of wiring)', () => {
  const forgot = authRoutes.stack.find(
    (layer) => layer.route && layer.route.path === '/forgot-password'
  ).route;
  const [limiterHandle, handlerHandle] = forgot.stack.map((l) => l.handle);

  // The mounted handle is the process-local 5/15min limiter: drive it directly
  // with a fixed socket and confirm the 6th call is stopped before the handler.
  let handlerCalls = 0;
  const next = () => {
    handlerCalls += 1;
  };
  const req = { socket: { remoteAddress: '203.0.113.7' }, headers: {} };

  for (let i = 0; i < 5; i += 1) {
    const res = fakeRes();
    limiterHandle(req, res, next);
    assert.notEqual(res.statusCode, 429);
  }
  assert.equal(handlerCalls, 5);

  const blockedRes = fakeRes();
  let handlerReached = false;
  limiterHandle(req, blockedRes, () => {
    handlerReached = true;
  });
  assert.equal(blockedRes.statusCode, 429);
  assert.equal(handlerReached, false, 'blocked request never reaches the controller');

  assert.equal(typeof handlerHandle, 'function', 'controller handler present behind the limiter');
});
