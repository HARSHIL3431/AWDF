import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { authController } from '../src/controllers/authController.js';
import User from '../src/models/userModel.js';
import { jobService, createJobService } from '../src/services/jobService.js';
import { createPayloadCipher } from '../src/security/payloadEncryption.js';
import { EMAIL_JOB_PURPOSE, JOB_POLICY } from '../src/config/jobConfig.js';
import { authenticateToken } from '../src/middleware/authMiddleware.js';
import { createJobStatsHandler } from '../src/controllers/debugController.js';
import { forgotPasswordRateLimiter } from '../src/middleware/rateLimiter.js';
import { createMemoryJobModel } from './helpers/memoryJobModel.js';

const TEST_KEY = crypto.randomBytes(32).toString('hex');
const CIPHER = createPayloadCipher(TEST_KEY);

// The exact accepted-response contract that must remain byte-for-byte stable.
const GENERIC_BODY = {
  message: 'If an account exists for this email, a password reset link has been sent.',
};
const GENERIC_JSON = JSON.stringify(GENERIC_BODY);

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

function makeReq({ body = {}, headers = {}, url = '/forgot-password', method = 'POST', correlationId } = {}) {
  return { body, headers, originalUrl: url, url, method, socket: { remoteAddress: '127.0.0.1' }, correlationId };
}

/** Patches a method and restores it automatically after the test. */
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

test('forgot-password: accepted response is byte-for-byte unchanged and enqueues a job', async (t) => {
  const order = [];
  let capturedPayload = null;
  let capturedCorrelation = null;
  let savedHash = null;
  let savedExpires = null;

  patch(t, User, 'findOne', async () => {
    order.push('findOne');
    return {
      email: 'known@example.com',
      resetPasswordToken: null,
      resetPasswordExpires: null,
      async save() {
        order.push('save');
        savedHash = this.resetPasswordToken;
        savedExpires = this.resetPasswordExpires;
      },
    };
  });
  patch(t, jobService, 'enqueuePasswordReset', async (payload, opts) => {
    order.push('enqueue');
    capturedPayload = payload;
    capturedCorrelation = opts?.correlationId;
    return { _id: 'job-1' };
  });
  const noteFailureCalls = [];
  patch(t, jobService, 'noteEnqueueFailure', (...args) => noteFailureCalls.push(args));

  const res = makeRes();
  await authController.forgotPassword(
    makeReq({ body: { email: ' Known@Example.com ' }, correlationId: 'corr-contract-1' }),
    res,
    (err) => {
      throw err;
    }
  );

  // Status + body byte-for-byte
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.body), GENERIC_JSON);
  assert.equal(noteFailureCalls.length, 0);

  // Sequence: find user -> persist hash/expiry -> enqueue job
  assert.deepEqual(order, ['findOne', 'save', 'enqueue']);

  // Existing security rules preserved: SHA-256 of the raw token, 15-min expiry
  assert.equal(typeof capturedPayload.resetToken, 'string');
  assert.match(capturedPayload.resetToken, /^[0-9a-f]{64}$/);
  assert.equal(savedHash, crypto.createHash('sha256').update(capturedPayload.resetToken).digest('hex'));
  const delta = savedExpires.getTime() - Date.now();
  assert.ok(delta > 14 * 60_000 && delta <= 15 * 60_000, `expiry ~15min (got ${delta}ms)`);
  assert.equal(capturedPayload.email, 'known@example.com');
  assert.equal(capturedCorrelation, 'corr-contract-1');
});

test('forgot-password: unknown account returns the identical generic response (no enumeration)', async (t) => {
  let enqueued = false;
  patch(t, User, 'findOne', async () => null);
  patch(t, jobService, 'enqueuePasswordReset', async () => {
    enqueued = true;
    return {};
  });

  const res = makeRes();
  let nextErr = null;
  await authController.forgotPassword(makeReq({ body: { email: 'nobody@example.com' } }), res, (e) => {
    nextErr = e;
  });

  assert.equal(nextErr, null);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.body), GENERIC_JSON, 'response identical to the known-account path');
  assert.equal(enqueued, false, 'no job for unknown accounts');
});

test('forgot-password: validation error shape unchanged', async (t) => {
  patch(t, User, 'findOne', async () => {
    throw new Error('findOne must not run when input is invalid');
  });

  for (const body of [{}, { email: '' }, { email: 42 }, { email: '   ' }]) {
    const res = makeRes();
    await authController.forgotPassword(makeReq({ body }), res, (e) => {
      throw e;
    });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: 'Email is required' });
  }
});

test('enqueue failure: generic response preserved, no sync fallback, failure recorded', async (t) => {
  const failures = [];
  patch(t, User, 'findOne', async () => ({
    email: 'victim@example.com',
    async save() {},
  }));
  patch(t, jobService, 'enqueuePasswordReset', async () => {
    throw new Error('job store unavailable');
  });
  patch(t, jobService, 'noteEnqueueFailure', (err, corr) => failures.push([err, corr]));

  const res = makeRes();
  let nextErr = null;
  await authController.forgotPassword(
    makeReq({ body: { email: 'victim@example.com' }, correlationId: 'corr-fail-1' }),
    res,
    (e) => {
      nextErr = e;
    }
  );

  assert.equal(nextErr, null, 'enqueue failure must not surface as a request error');
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.body), GENERIC_JSON, 'approved policy: accepted response unchanged');
  assert.equal(failures.length, 1, 'operational failure recorded');
  assert.equal(failures[0][0].message, 'job store unavailable');
  assert.equal(failures[0][1], 'corr-fail-1');
});

test('controller no longer imports/awaits the email service (SMTP off the request path)', async () => {
  const source = await readFile(
    fileURLToPath(new URL('../src/controllers/authController.js', import.meta.url)),
    'utf8'
  );
  assert.ok(!source.includes('sendPasswordResetEmail'), 'no direct SMTP call remains in the controller');
  assert.ok(!source.includes('emailService'), 'email service import removed');
  assert.match(source, /enqueuePasswordReset/, 'job enqueue present');
  assert.ok(!source.includes('await sendPasswordResetEmail'));
});

test('end-to-end controller path stores only an encrypted payload (real service + fake DB)', async (t) => {
  const JobModel = createMemoryJobModel();
  const isolated = createJobService({ JobModel, cipher: CIPHER, logger: { error() {} } });

  let rawToken = null;
  patch(t, User, 'findOne', async () => ({
    email: 'deep@example.com',
    async save() {},
  }));
  patch(t, jobService, 'enqueuePasswordReset', (payload, opts) =>
    isolated.enqueuePasswordReset(payload, opts)
  );

  // Capture the token the controller generated by watching the isolated store
  // after the fact (payload is encrypted at rest; decrypt with the test key).
  const res = makeRes();
  await authController.forgotPassword(makeReq({ body: { email: 'deep@example.com' } }), res, () => {});

  assert.equal(res.statusCode, 200);
  assert.equal(JobModel.store.length, 1);
  const stored = JobModel.store[0];
  const serialized = JSON.stringify(stored);
  assert.equal(stored.type, 'email.password_reset');
  assert.equal(stored.payload.v, 1, 'payload is an encryption envelope');
  rawToken = CIPHER.decrypt(stored.payload, EMAIL_JOB_PURPOSE).resetToken;
  assert.match(rawToken, /^[0-9a-f]{64}$/);
  // The serialized document never contains the raw token in plaintext
  assert.ok(!serialized.includes(rawToken));
  assert.ok(!serialized.includes('deep@example.com'));
});

test('rate limiter precedes the controller: 6th forgot-password attempt is stopped', () => {
  // Mounted instance from authRoutes is exercised here via the shared export
  // (same object: routes import forgotPasswordRateLimiter).
  const req = { socket: { remoteAddress: '198.51.100.42' }, headers: {} };
  let passed = 0;
  const next = () => {
    passed += 1;
  };
  for (let i = 0; i < 5; i += 1) {
    const res = makeRes();
    forgotPasswordRateLimiter(req, res, next);
    assert.equal(res.statusCode, null);
  }
  const res6 = makeRes();
  forgotPasswordRateLimiter(req, res6, next);
  assert.equal(res6.statusCode, 429);
  assert.equal(passed, 5);
  assert.deepEqual(res6.body, { error: 'Too many requests. Please try again later.' });
});

test('authenticateToken: unauthorized access is rejected (401 contract)', () => {
  const cases = [
    { headers: {} },
    { headers: { authorization: 'Bearer' } },
    { headers: { authorization: 'Basic abc' } },
    { headers: { authorization: 'Bearer garbage.token.here' } },
  ];
  for (const req of cases) {
    const res = makeRes();
    let passed = false;
    authenticateToken(req, res, () => {
      passed = true;
    });
    assert.equal(passed, false, 'request without valid JWT must not pass');
    assert.equal(res.statusCode, 401);
    assert.ok(typeof res.body.error === 'string');
  }
});

test('GET /debug/jobs: authenticated, aggregate-only, no sensitive fields', async () => {
  const JobModel = createMemoryJobModel();
  const isolated = createJobService({ JobModel, cipher: CIPHER, logger: { error() {} } });
  const secretPayload = {
    email: 'stats@example.com',
    resetToken: crypto.randomBytes(32).toString('hex'),
    frontendUrl: 'http://localhost:5173',
  };
  const job = await isolated.enqueuePasswordReset(secretPayload);
  await isolated.claimDueJob(Date.now() + 1_000);
  JobModel.insert({
    type: 'email.password_reset',
    payload: CIPHER.encrypt(secretPayload, EMAIL_JOB_PURPOSE),
    status: 'dead',
    attempts: JOB_POLICY.maxAttempts,
    errorCategory: 'smtp_error',
    errorMessage: 'delivery failed after retries',
  });
  await isolated.noteEnqueueFailure(new Error('x'), 'c');

  const handler = createJobStatsHandler({ statsProvider: isolated });
  const res = makeRes();
  let nextErr = null;
  await handler({ user: { id: 'u1' } }, res, (e) => {
    nextErr = e;
  });

  assert.equal(nextErr, null);
  assert.equal(res.statusCode, 200);

  const serialized = JSON.stringify(res.body);
  // Stable documented structure
  assert.deepEqual(Object.keys(res.body).sort(), [
    'counts',
    'deadCount',
    'enqueueFailures',
    'oldestPendingAgeMs',
    'processingCount',
    'queued',
  ]);
  assert.equal(res.body.counts.dead, 1);
  assert.equal(res.body.counts.processing, 1);
  assert.equal(res.body.counts.total, 2);
  assert.equal(res.body.deadCount, 1);
  assert.equal(res.body.processingCount, 1);
  assert.equal(res.body.enqueueFailures, 1);

  // Sensitive material must never appear
  assert.ok(!serialized.includes(secretPayload.resetToken));
  assert.ok(!serialized.includes('payload'), 'no payload key');
  assert.ok(!serialized.includes('@'), 'no email addresses');
  assert.ok(!serialized.includes(secretPayload.email));
  assert.ok(!serialized.includes('correlation'), 'no correlation ids');
  assert.ok(!serialized.includes('delivery failed after retries'), 'no raw error text');
  assert.ok(!serialized.includes(TEST_KEY), 'no encryption key material');

  // Untouched job id also absent
  assert.ok(!serialized.includes(String(job._id)));
});

test('debug endpoint wiring: route exists and sits behind authenticateToken', async () => {
  const source = await readFile(
    fileURLToPath(new URL('../server.js', import.meta.url)),
    'utf8'
  );
  assert.match(
    source,
    /app\.get\(\s*'\/debug\/jobs',\s*authenticateToken,\s*createJobStatsHandler/,
    '/debug/jobs must be mounted with authenticateToken'
  );
});
