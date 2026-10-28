import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { connectTestDb, disconnectTestDb, wipeIsolatedData } from '../helpers/testDb.js';
import Job from '../../src/models/jobModel.js';
import User from '../../src/models/userModel.js';
import { jobService, createJobService } from '../../src/services/jobService.js';
import { createEmailWorker } from '../../src/workers/emailWorker.js';
import { authController } from '../../src/controllers/authController.js';
import { authenticateToken } from '../../src/middleware/authMiddleware.js';
import { createJobStatsHandler } from '../../src/controllers/debugController.js';
import { getPayloadCipher } from '../../src/security/payloadEncryption.js';
import { EMAIL_JOB_PURPOSE, JOB_POLICY } from '../../src/config/jobConfig.js';

/**
 * Integration: worker against the real job store, forgot-password
 * compatibility, enqueue-failure policy, and the authenticated statistics
 * endpoint. Email delivery is ALWAYS mocked — no SMTP contact, ever.
 */

if (!process.env.JOB_PAYLOAD_ENCRYPTION_KEY) {
  process.env.JOB_PAYLOAD_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
}
process.env.JWT_SECRET = 'integration-jwt-secret-for-tests';
const CIPHER = getPayloadCipher();

const GENERIC_BODY = {
  message: 'If an account exists for this email, a password reset link has been sent.',
};

const PAYLOAD = {
  email: 'it-worker@example.com',
  resetToken: crypto.randomBytes(32).toString('hex'),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
};

function silentLogger() {
  const records = { logs: [], errors: [] };
  return {
    records,
    logger: {
      log: (...a) => records.logs.push(a.map(String).join(' ')),
      error: (...a) => records.errors.push(a.map(String).join(' ')),
    },
  };
}

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

async function waitFor(fn, timeoutMs = 5_000, stepMs = 25) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

before(async () => {
  await connectTestDb();
  await Job.init();
  await User.init();
});

after(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await wipeIsolatedData(['jobs', 'users']);
});

test('worker: successful delivery persists succeeded state in the real store', async () => {
  const calls = [];
  const { logger } = silentLogger();
  await jobService.enqueuePasswordReset(PAYLOAD, { correlationId: 'it-w1' });

  const worker = createEmailWorker({
    jobService,
    sendEmail: async (email, token, url) => {
      calls.push({ email, token, url });
      return { success: true };
    },
    cipher: CIPHER,
    logger,
  });

  await worker.runOnce();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].email, PAYLOAD.email);
  assert.equal(calls[0].token, PAYLOAD.resetToken);

  const stored = await Job.findOne({ status: 'succeeded' });
  assert.ok(stored, 'succeeded job persisted');
  assert.ok(stored.completedAt instanceof Date);
  assert.ok(stored.expiresAt instanceof Date);
  assert.ok(stored.leaseUntil === undefined || stored.leaseUntil === null, 'lease cleared');
});

test('worker: retryable failure persists pending + backoff; second attempt succeeds', async () => {
  const { logger } = silentLogger();
  let shouldFail = true;
  const worker = createEmailWorker({
    jobService,
    sendEmail: async () => (shouldFail ? { success: false, error: 'smtp down' } : { success: true }),
    cipher: CIPHER,
    logger,
  });

  const created = await jobService.enqueuePasswordReset(PAYLOAD);
  await worker.runOnce();

  let stored = await Job.findById(created._id);
  assert.equal(stored.status, 'pending');
  assert.equal(stored.attempts, 1);
  assert.equal(stored.errorCategory, 'smtp_error');
  assert.ok(stored.nextAttemptAt.getTime() > Date.now());

  // Make it due now and let the worker retry successfully.
  shouldFail = false;
  await Job.updateOne({ _id: created._id }, { $set: { nextAttemptAt: new Date(Date.now() - 1_000) } });
  await worker.runOnce();

  stored = await Job.findById(created._id);
  assert.equal(stored.status, 'succeeded');
  assert.equal(stored.attempts, 2, 'two attempts recorded');
});

test('worker: exhausted attempts persist as dead in the real store', async () => {
  const { logger } = silentLogger();
  const worker = createEmailWorker({
    jobService,
    sendEmail: async () => ({ success: false, error: 'permanently rejected' }),
    cipher: CIPHER,
    logger,
  });

  const created = await jobService.enqueuePasswordReset(PAYLOAD);
  await Job.updateOne(
    { _id: created._id },
    { $set: { attempts: JOB_POLICY.maxAttempts - 1, nextAttemptAt: new Date(Date.now() - 1_000) } }
  );

  await worker.runOnce();

  const stored = await Job.findById(created._id);
  assert.equal(stored.status, 'dead');
  assert.equal(stored.attempts, JOB_POLICY.maxAttempts);
  assert.match(stored.errorMessage, /attempts exhausted/);
  assert.ok(stored.expiresAt instanceof Date);
});

test('worker: crash recovery — expired lease job is reclaimed and re-sent (at-least-once)', async () => {
  const calls = [];
  const { logger } = silentLogger();
  const crashed = new Job({
    type: 'email.password_reset',
    payload: CIPHER.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE),
    status: 'processing',
    attempts: 1,
    leaseUntil: new Date(Date.now() - 1_000),
    startedAt: new Date(Date.now() - 130_000),
  });
  await crashed.save();

  const worker = createEmailWorker({
    jobService,
    sendEmail: async () => {
      calls.push(true);
      return { success: true };
    },
    cipher: CIPHER,
    logger,
  });
  await worker.runOnce();

  assert.equal(calls.length, 1);
  const stored = await Job.findById(crashed._id);
  assert.equal(stored.status, 'succeeded');
  assert.equal(stored.attempts, 2);
});

test('worker: graceful shutdown against the real store — drained, then no new claims', async () => {
  const { logger } = silentLogger();
  const worker = createEmailWorker({
    jobService,
    sendEmail: async () => ({ success: true }),
    cipher: CIPHER,
    policy: { ...JOB_POLICY, pollIntervalMs: 30 },
    logger,
  });

  await jobService.enqueuePasswordReset(PAYLOAD);
  worker.start();
  const delivered = await waitFor(async () => (await Job.countDocuments({ status: 'succeeded' })) === 1);
  assert.ok(delivered, 'worker delivered within the polling window');

  const stopResult = await worker.stop(5_000);
  assert.equal(stopResult.stopped, true);
  assert.equal(stopResult.drained, true);
  assert.equal(worker.isRunning(), false);

  // After stop the loop must not claim anything else.
  await jobService.enqueuePasswordReset(PAYLOAD);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(await Job.countDocuments({ status: 'pending' }), 1, 'stopped worker must not claim');
  assert.equal(await Job.countDocuments({ status: 'processing' }), 0);
});

test('forgot-password: byte-identical response + real encrypted job + hashed token persisted', async (t) => {
  const password = await bcrypt.hash('Integration1!', 4);
  await User.create({ email: 'it-forgot@example.com', password });

  const res = makeRes();
  let nextErr = null;
  await authController.forgotPassword(
    { body: { email: 'it-forgot@example.com' }, headers: {}, correlationId: 'it-corr-fp' },
    res,
    (e) => {
      nextErr = e;
    }
  );

  assert.equal(nextErr, null);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.body), JSON.stringify(GENERIC_BODY), 'byte-for-byte contract');

  const user = await User.findOne({ email: 'it-forgot@example.com' }).select(
    '+resetPasswordToken +resetPasswordExpires'
  );
  assert.match(user.resetPasswordToken, /^[0-9a-f]{64}$/, 'SHA-256 hash stored');
  assert.ok(user.resetPasswordExpires instanceof Date);

  const job = await Job.findOne({ correlationId: 'it-corr-fp' }).select('+payload');
  assert.ok(job, 'job persisted with correlation id');
  assert.equal(job.type, 'email.password_reset');
  assert.equal(job.status, 'pending');
  assert.equal(JSON.stringify(job).includes(user.resetPasswordToken), false);

  const payload = CIPHER.decrypt(job.payload, EMAIL_JOB_PURPOSE);
  assert.equal(payload.email, 'it-forgot@example.com');
  assert.equal(
    crypto.createHash('sha256').update(payload.resetToken).digest('hex'),
    user.resetPasswordToken,
    'stored hash matches the queued raw token'
  );
  assert.ok(!JSON.stringify(payload).includes(user.resetPasswordToken));
});

test('forgot-password: unknown account — identical response, zero jobs created', async () => {
  const res = makeRes();
  await authController.forgotPassword(
    { body: { email: 'it-unknown@example.com' }, headers: {} },
    res,
    (e) => {
      throw e;
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.body), JSON.stringify(GENERIC_BODY));
  assert.equal(await Job.countDocuments({}), 0, 'no job for unknown accounts');
});

test('forgot-password: enqueue failure — generic response, no sync fallback, no job', async (t) => {
  const password = await bcrypt.hash('Integration1!', 4);
  await User.create({ email: 'it-enqfail@example.com', password });

  const failuresBefore = jobService.getEnqueueFailures();
  patch(t, jobService, 'enqueuePasswordReset', async () => {
    throw new Error('simulated store outage');
  });

  const res = makeRes();
  let nextErr = null;
  await authController.forgotPassword(
    { body: { email: 'it-enqfail@example.com' }, correlationId: 'it-corr-fail' },
    res,
    (e) => {
      nextErr = e;
    }
  );

  assert.equal(nextErr, null, 'enqueue failure must not surface as a request error');
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.body), JSON.stringify(GENERIC_BODY), 'no synchronous fallback contract change');
  assert.equal(jobService.getEnqueueFailures(), failuresBefore + 1, 'operational counter incremented');
  assert.equal(await Job.countDocuments({}), 0, 'no job persisted on enqueue failure');

  // The user document was still saved (token hash + expiry) for a later retry.
  const user = await User.findOne({ email: 'it-enqfail@example.com' }).select('+resetPasswordToken');
  assert.match(user.resetPasswordToken, /^[0-9a-f]{64}$/);
});

test('auth + statistics: 401 unauthenticated; authenticated response is aggregate-only', async () => {
  // Unauthenticated
  const unauthRes = makeRes();
  let passed = false;
  authenticateToken({ headers: {} }, unauthRes, () => {
    passed = true;
  });
  assert.equal(passed, false);
  assert.equal(unauthRes.statusCode, 401);

  // Seed real aggregate data
  const seeded = await jobService.enqueuePasswordReset(PAYLOAD);
  await jobService.claimDueJob(Date.now() + 1_000);
  await Job.collection.insertOne({
    type: 'email.password_reset',
    payload: CIPHER.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE),
    status: 'dead',
    attempts: JOB_POLICY.maxAttempts,
    maxAttempts: JOB_POLICY.maxAttempts,
    nextAttemptAt: new Date(),
    completedAt: new Date(),
    expiresAt: new Date(Date.now() + JOB_POLICY.terminalRetentionMs),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const handler = createJobStatsHandler();
  const res = makeRes();
  let nextErr = null;
  await handler({ user: { id: 'it-user' } }, res, (e) => {
    nextErr = e;
  });

  assert.equal(nextErr, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.counts.total, 2);
  assert.equal(res.body.counts.processing, 1);
  assert.equal(res.body.counts.dead, 1);
  assert.equal(res.body.processingCount, 1);
  assert.equal(res.body.deadCount, 1);

  const serialized = JSON.stringify(res.body);
  assert.ok(!serialized.includes(PAYLOAD.email));
  assert.ok(!serialized.includes(PAYLOAD.resetToken));
  assert.ok(!serialized.includes('payload'));
  assert.ok(!serialized.includes('@'));
  assert.ok(!serialized.includes(String(seeded._id)));
  assert.ok(!serialized.includes('delivery failed'));

  // Authenticated middleware path with a valid JWT (sign/verify same secret)
  const token = jwt.sign({ id: 'it-user' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const authReq = { headers: { authorization: `Bearer ${token}` } };
  let authPassed = false;
  authenticateToken(authReq, makeRes(), () => {
    authPassed = true;
  });
  assert.equal(authPassed, true);
  assert.equal(authReq.user.id, 'it-user');
});
