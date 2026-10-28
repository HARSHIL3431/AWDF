import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authController } from '../src/controllers/authController.js';
import User from '../src/models/userModel.js';
import { authenticateToken } from '../src/middleware/authMiddleware.js';
import { validateContentType } from '../src/middleware/validateContentType.js';
import { validateTaskId } from '../src/middleware/validateTaskId.js';
import { cacheService } from '../src/services/cacheService.js';
import { taskController } from '../src/controllers/taskController.js';

// Tests set their own secret so behavior is deterministic regardless of .env.
const TEST_SECRET = 'regression-test-secret';
process.env.JWT_SECRET = TEST_SECRET;

function makeRes() {
  return {
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
}

const patchRegistry = new WeakMap();

/** Patches a method; all patches from one test restore in reverse order. */
function patch(t, target, name, impl) {
  let list = patchRegistry.get(t);
  if (list === undefined) {
    list = [];
    patchRegistry.set(t, list);
    t.after(() => {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        list[i].target[list[i].name] = list[i].original;
      }
    });
  }
  list.push({ target, name, original: target[name] });
  target[name] = impl;
}

test('regression: login success returns token + user without password', async (t) => {
  const hashed = await bcrypt.hash('Password123!', 10);
  patch(t, User, 'findOne', async (query) => {
    assert.deepEqual(query, { email: 'login@example.com' });
    return {
      _id: 'u-1',
      email: 'login@example.com',
      password: hashed,
      toJSON() {
        return { id: 'u-1', email: 'login@example.com' };
      },
    };
  });

  const res = makeRes();
  await authController.login(
    { body: { email: 'Login@Example.com', password: 'Password123!' } },
    res,
    (e) => {
      throw e;
    }
  );

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.token);
  const decoded = jwt.verify(res.body.token, TEST_SECRET);
  assert.equal(decoded.id, 'u-1');
  assert.equal(res.body.user.email, 'login@example.com');
  assert.ok(!JSON.stringify(res.body).includes(hashed), 'password hash never serialized');
});

test('regression: login with wrong password -> 401, invalid user -> 401', async (t) => {
  const hashed = await bcrypt.hash('Password123!', 10);
  patch(t, User, 'findOne', async () => ({
    email: 'x@example.com',
    password: hashed,
    toJSON: () => ({ id: 'u' }),
  }));

  const res1 = makeRes();
  await authController.login({ body: { email: 'x@example.com', password: 'wrong' } }, res1, (e) => {
    throw e;
  });
  assert.equal(res1.statusCode, 401);
  assert.deepEqual(res1.body, { error: 'Invalid credentials' });

  patch(t, User, 'findOne', async () => null);
  const res2 = makeRes();
  await authController.login({ body: { email: 'none@example.com', password: 'x' } }, res2, (e) => {
    throw e;
  });
  assert.equal(res2.statusCode, 401);
  assert.deepEqual(res2.body, { error: 'Invalid credentials' });
});

test('regression: register hashes the password and never returns it', async (t) => {
  let created = null;
  patch(t, User, 'findOne', async () => null);
  patch(t, User, 'create', async (doc) => {
    created = doc;
    return { toJSON: () => ({ id: 'new-1', email: doc.email }) };
  });

  const res = makeRes();
  await authController.register({ body: { email: 'New@Example.com', password: 'Password123!' } }, res, (e) => {
    throw e;
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.message, 'User registered successfully');
  assert.notEqual(created.password, 'Password123!');
  assert.match(created.password, /^\$2[aby]\$/);
  assert.equal(created.email, 'new@example.com', 'email normalized');
  assert.ok(!JSON.stringify(res.body).includes('Password123!'));
});

test('regression: register duplicate email -> 400 (existing user and 11000 race)', async (t) => {
  patch(t, User, 'findOne', async () => ({ email: 'dup@example.com' }));
  const res1 = makeRes();
  await authController.register({ body: { email: 'dup@example.com', password: 'x' } }, res1, (e) => {
    throw e;
  });
  assert.equal(res1.statusCode, 400);
  assert.deepEqual(res1.body, { error: 'Email already registered' });

  patch(t, User, 'findOne', async () => null);
  patch(t, User, 'create', async () => {
    const err = new Error('E11000 duplicate key');
    err.code = 11000;
    throw err;
  });
  const res2 = makeRes();
  await authController.register({ body: { email: 'race@example.com', password: 'x' } }, res2, (e) => {
    throw e;
  });
  assert.equal(res2.statusCode, 400);
  assert.deepEqual(res2.body, { error: 'Email already registered' });
});

test('regression: getMe returns the user profile', async (t) => {
  patch(t, User, 'findById', async (id) => {
    assert.equal(id, 'u-77');
    return { email: 'me@example.com', toJSON: () => ({ id: 'u-77', email: 'me@example.com' }) };
  });
  const res = makeRes();
  await authController.getMe({ user: { id: 'u-77' } }, res, (e) => {
    throw e;
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { id: 'u-77', email: 'me@example.com' });
});

test('regression: reset-password verifies SHA-256 hash + expiry, clears fields, rehashes', async (t) => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  let seenFilter = null;
  let cleared = null;
  let savedCount = 0;
  let newPasswordHash = null;

  patch(t, User, 'findOne', async (filter) => {
    seenFilter = filter;
    return {
      email: 'reset@example.com',
      async save() {
        savedCount += 1;
        cleared = { token: this.resetPasswordToken, expires: this.resetPasswordExpires };
        newPasswordHash = this.password;
      },
    };
  });

  const res = makeRes();
  await authController.resetPassword(
    { params: { token: rawToken }, body: { password: 'BrandNewPass1!' } },
    res,
    (e) => {
      throw e;
    }
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { message: 'Password reset successfully' });

  // Lookup contract unchanged: SHA-256 hex match with $gt now expiry check
  assert.equal(seenFilter.resetPasswordToken, hashedToken);
  assert.match(seenFilter.resetPasswordToken, /^[0-9a-f]{64}$/);
  assert.ok(seenFilter.resetPasswordExpires.$gt instanceof Date);

  // Fields cleared; new password bcrypt-hashed
  assert.equal(savedCount, 1);
  assert.equal(cleared.token, undefined);
  assert.equal(cleared.expires, undefined);
  assert.notEqual(newPasswordHash, 'BrandNewPass1!');
  assert.equal(await bcrypt.compare('BrandNewPass1!', newPasswordHash), true);
});

test('regression: reset-password with invalid/expired token -> 400', async (t) => {
  patch(t, User, 'findOne', async () => null);
  const res = makeRes();
  await authController.resetPassword(
    { params: { token: 'deadbeef'.repeat(8) }, body: { password: 'x' } },
    res,
    (e) => {
      throw e;
    }
  );
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Invalid or expired reset token' });
});

test('regression: authenticateToken accepts a valid JWT', () => {
  const token = jwt.sign({ id: 'u-9' }, TEST_SECRET, { expiresIn: '1h' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  let passed = false;
  const res = makeRes();
  authenticateToken(req, res, () => {
    passed = true;
  });
  assert.equal(passed, true);
  assert.equal(req.user.id, 'u-9');
  assert.equal(res.statusCode, null, 'no response written on success');
});

test('regression: validateContentType gate unchanged', () => {
  const postNoCt = makeRes();
  let next1 = false;
  validateContentType({ method: 'POST', headers: {} }, postNoCt, () => {
    next1 = true;
  });
  assert.equal(next1, false);
  assert.equal(postNoCt.statusCode, 400);
  assert.deepEqual(postNoCt.body, { error: 'Content-Type must be application/json' });

  let next2 = false;
  validateContentType(
    { method: 'POST', headers: { 'content-type': 'application/json' } },
    makeRes(),
    () => {
      next2 = true;
    }
  );
  assert.equal(next2, true);

  let next3 = false;
  validateContentType({ method: 'GET', headers: {} }, makeRes(), () => {
    next3 = true;
  });
  assert.equal(next3, true, 'GET unaffected');
});

test('regression: validateTaskId rejects malformed ObjectIds without touching the database', async () => {
  const res = makeRes();
  let nextCalled = false;
  let nextErr = null;
  await validateTaskId({ params: { id: 'not-an-objectid' }, method: 'GET' }, res, (err) => {
    if (err) nextErr = err;
    else nextCalled = true;
  });
  assert.equal(nextErr, null);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'Task not found' });
});

test('regression: task cache behavior unchanged (set/get/invalidation/stats)', () => {
  cacheService.flush();
  cacheService.resetStats();

  // miss then hit
  assert.equal(cacheService.get('tasks:all'), undefined);
  assert.equal(cacheService.getStats().misses, 1);

  cacheService.set('tasks:all', [{ id: '1', title: 'a' }]);
  assert.deepEqual(cacheService.get('tasks:all'), [{ id: '1', title: 'a' }]);
  assert.equal(cacheService.getStats().hits, 1);

  // single-task cache + invalidation clears list and the affected id
  cacheService.set('tasks:id:t1', { id: 't1' });
  cacheService.invalidateTaskCaches('t1');
  assert.equal(cacheService.get('tasks:all'), undefined);
  assert.equal(cacheService.get('tasks:id:t1'), undefined);

  // invalidation without id only clears the list key
  cacheService.set('tasks:all', []);
  cacheService.set('tasks:id:t2', { id: 't2' });
  cacheService.invalidateTaskCaches();
  assert.equal(cacheService.get('tasks:all'), undefined);
  assert.deepEqual(cacheService.get('tasks:id:t2'), { id: 't2' }, 'other id kept');

  const stats = cacheService.getStats();
  assert.equal(typeof stats.hitRate, 'number');
  assert.ok(stats.totalRequests >= 3);

  cacheService.flush();
  cacheService.resetStats();
});

test('regression: task controller surface unchanged (no async refactor slipped in)', () => {
  for (const name of ['getAllTasks', 'getTaskById', 'createTask', 'updateTask', 'deleteTask']) {
    assert.equal(typeof taskController[name], 'function', `${name} present`);
    assert.equal(taskController[name].constructor.name, 'AsyncFunction', `${name} still async`);
  }
});

test('regression: forgot-password validation still precedes any user lookup (controller unit)', async (t) => {
  let findOneCalled = false;
  patch(t, User, 'findOne', async () => {
    findOneCalled = true;
    return null;
  });
  const res = makeRes();
  await authController.forgotPassword({ body: {} }, res, (e) => {
    throw e;
  });
  assert.equal(res.statusCode, 400);
  assert.equal(findOneCalled, false);
});
