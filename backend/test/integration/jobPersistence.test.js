import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { connectTestDb, disconnectTestDb, wipeIsolatedData } from '../helpers/testDb.js';
import Job from '../../src/models/jobModel.js';
import { createJobService } from '../../src/services/jobService.js';
import { getPayloadCipher } from '../../src/security/payloadEncryption.js';
import { EMAIL_JOB_PURPOSE, JOB_POLICY } from '../../src/config/jobConfig.js';

/**
 * Integration: real MongoDB job persistence (isolated *_test database only —
 * every connection passes test/helpers/dbGuard.js first; refusal = no I/O).
 * Email transport is never used in this file.
 */

// Ensure a valid payload-encryption key exists for this test process (ephemeral
// if none is configured). Never printed.
if (!process.env.JOB_PAYLOAD_ENCRYPTION_KEY) {
  process.env.JOB_PAYLOAD_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
}
const CIPHER = getPayloadCipher();

const PAYLOAD = {
  email: 'it-persistence@example.com',
  resetToken: crypto.randomBytes(32).toString('hex'),
  frontendUrl: 'http://localhost:5173',
};

let service;

before(async () => {
  await connectTestDb(); // guard: refuses unless an isolated *_test DB is approved
  await Job.init(); // build schema indexes on the test database
  service = createJobService({ cipher: CIPHER });
});

after(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await wipeIsolatedData(['jobs', 'users']);
});

test('indexes: claim, lease-recovery, and terminal TTL indexes exist on the real collection', async () => {
  const indexes = await Job.collection.indexes();
  const hasIndex = (keys, extra = {}) =>
    indexes.some((idx) => {
      const entries = Object.entries(idx.key);
      const keysMatch =
        entries.length === Object.keys(keys).length &&
        entries.every(([k, v]) => keys[k] === v);
      const extrasMatch = Object.entries(extra).every(([k, v]) => idx[k] === v);
      return keysMatch && extrasMatch;
    });

  assert.ok(hasIndex({ status: 1, nextAttemptAt: 1 }), 'claim index missing');
  assert.ok(hasIndex({ status: 1, leaseUntil: 1 }), 'lease-recovery index missing');
  assert.ok(hasIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }), 'TTL index missing');
});

test('persistence: job round-trips through MongoDB with payload hidden by default', async () => {
  const created = await service.enqueuePasswordReset(PAYLOAD, { correlationId: 'it-corr-1' });
  const storedId = created._id;

  const reloaded = await Job.findById(storedId);
  assert.ok(reloaded, 'job persisted');
  assert.equal(reloaded.type, 'email.password_reset');
  assert.equal(reloaded.status, 'pending');
  assert.equal(reloaded.attempts, 0);
  assert.equal(reloaded.maxAttempts, JOB_POLICY.maxAttempts);
  assert.equal(reloaded.correlationId, 'it-corr-1');
  assert.equal(reloaded.expiresAt, null, 'active jobs carry no TTL expiry');
  assert.equal(reloaded.payload, undefined, 'payload excluded from default queries');

  const serialized = JSON.stringify(reloaded.toJSON());
  assert.ok(!serialized.includes(PAYLOAD.resetToken), 'raw token never serialized');
  assert.ok(!serialized.includes(PAYLOAD.email), 'email never serialized');

  const withPayload = await Job.findById(storedId).select('+payload');
  assert.ok(withPayload.payload?.iv && withPayload.payload?.tag && withPayload.payload?.ct);
  assert.deepEqual(CIPHER.decrypt(withPayload.payload, EMAIL_JOB_PURPOSE), PAYLOAD);
});

test('retry: scheduleRetry persists nextAttemptAt within the jittered backoff window', async () => {
  const job = await service.enqueuePasswordReset(PAYLOAD);
  const claimed = await service.claimDueJob(Date.now() + 1_000);
  assert.equal(String(claimed._id), String(job._id));
  assert.equal(claimed.status, 'processing');
  assert.equal(claimed.attempts, 1);
  assert.ok(claimed.leaseUntil instanceof Date);

  const at = Date.now();
  const res = await service.scheduleRetry(claimed, { category: 'smtp_error', message: 'down' }, at);
  assert.equal(res.status, 'pending');

  const stored = await Job.findById(job._id);
  assert.equal(stored.status, 'pending');
  const deltaMs = stored.nextAttemptAt.getTime() - at;
  assert.ok(deltaMs >= 15_000 && deltaMs <= 30_000, `backoff ${deltaMs}ms outside [15s,30s]`);
  assert.equal(stored.errorCategory, 'smtp_error');
  assert.equal(stored.errorMessage, 'down');
  assert.equal(stored.leaseUntil ?? null, null);
});

test('dead-letter: exhausted attempts persist as dead with retention expiry', async () => {
  const job = await service.enqueuePasswordReset(PAYLOAD);
  const claimed = await service.claimDueJob(Date.now() + 1_000);
  claimed.attempts = JOB_POLICY.maxAttempts; // entering the final attempt

  const at = Date.now();
  const res = await service.scheduleRetry(claimed, { category: 'smtp_error', message: 'bye' }, at);
  assert.equal(res.status, 'dead');

  const stored = await Job.findById(job._id);
  assert.equal(stored.status, 'dead');
  assert.equal(stored.attempts, JOB_POLICY.maxAttempts);
  assert.match(stored.errorMessage, /attempts exhausted: 5\/5/);
  assert.equal(stored.completedAt.getTime(), at);
  assert.equal(stored.expiresAt.getTime(), at + JOB_POLICY.terminalRetentionMs);

  // Terminal jobs are not claimable.
  assert.equal(await service.claimDueJob(Date.now() + 60_000), null);
});

test('lease recovery: only expired processing jobs requeue; live leases untouched', async () => {
  const crashed = new Job({
    type: 'email.password_reset',
    payload: CIPHER.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE),
    status: 'processing',
    attempts: 1,
    leaseUntil: new Date(Date.now() - 1_000),
    startedAt: new Date(Date.now() - 130_000),
  });
  const live = new Job({
    type: 'email.password_reset',
    payload: CIPHER.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE),
    status: 'processing',
    attempts: 1,
    leaseUntil: new Date(Date.now() + 60_000),
    startedAt: new Date(),
  });
  await crashed.save();
  await live.save();

  const recovered = await service.recoverExpiredLeases(Date.now());
  assert.equal(recovered, 1);

  const crashedAfter = await Job.findById(crashed._id);
  assert.equal(crashedAfter.status, 'pending');
  assert.equal(crashedAfter.attempts, 1, 'recovery does not consume an attempt');
  assert.equal(crashedAfter.leaseUntil ?? null, null);

  const liveAfter = await Job.findById(live._id);
  assert.equal(liveAfter.status, 'processing', 'a live lease must never be stolen');
});

test('retention: terminal jobs get expiresAt; active jobs never do', async () => {
  const active = await service.enqueuePasswordReset(PAYLOAD);
  const claimed = await service.claimDueJob(Date.now() + 1_000);
  await service.markSucceeded(claimed, Date.now());

  const activeStored = await Job.findById(active._id);
  assert.equal(activeStored.status, 'succeeded');
  assert.ok(activeStored.expiresAt instanceof Date, 'terminal job has TTL expiry');

  const pending = await service.enqueuePasswordReset(PAYLOAD);
  const pendingStored = await Job.findById(pending._id);
  assert.equal(pendingStored.expiresAt, null, 'pending job has NO TTL expiry');
});
