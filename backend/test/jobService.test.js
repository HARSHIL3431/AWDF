import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createJobService, JobServiceError } from '../src/services/jobService.js';
import { createPayloadCipher } from '../src/security/payloadEncryption.js';
import { EMAIL_JOB_PURPOSE, JOB_POLICY } from '../src/config/jobConfig.js';
import { createMemoryJobModel } from './helpers/memoryJobModel.js';

const TEST_KEY = crypto.randomBytes(32).toString('hex');
const CIPHER = createPayloadCipher(TEST_KEY);

const RESET_PAYLOAD = {
  email: 'user@example.com',
  resetToken: crypto.randomBytes(32).toString('hex'),
  frontendUrl: 'http://localhost:5173',
};

function makeService(overrides = {}) {
  const JobModel = createMemoryJobModel();
  const logs = { errors: [], logs: [] };
  const service = createJobService({
    JobModel,
    cipher: CIPHER,
    logger: {
      error: (...args) => logs.errors.push(args.map(String).join(' ')),
      log: (...args) => logs.logs.push(args.map(String).join(' ')),
    },
    random: () => 0, // deterministic backoff: lower bound exp/2
    ...overrides,
  });
  return { service, JobModel, logs };
}

test('enqueue: encrypts payload and persists an envelope, not plaintext', async () => {
  const { service, JobModel } = makeService();
  const job = await service.enqueuePasswordReset(RESET_PAYLOAD, { correlationId: 'corr-1' });

  assert.equal(job.type, 'email.password_reset');
  assert.equal(job.status, 'pending');
  assert.equal(job.attempts, 0);
  assert.equal(job.maxAttempts, JOB_POLICY.maxAttempts);
  assert.equal(job.correlationId, 'corr-1');
  assert.equal(job.expiresAt, null, 'pending jobs must not have TTL expiry');

  const stored = JobModel.store[0];
  const serialized = JSON.stringify(stored);
  assert.ok(!serialized.includes(RESET_PAYLOAD.resetToken), 'raw token must not be stored');
  assert.ok(!serialized.includes(RESET_PAYLOAD.email), 'email must not be stored in plaintext');
  assert.equal(stored.payload.v, 1);
  assert.ok(stored.payload.iv && stored.payload.tag && stored.payload.ct);

  const decrypted = CIPHER.decrypt(stored.payload, EMAIL_JOB_PURPOSE);
  assert.deepEqual(decrypted, RESET_PAYLOAD);
});

test('enqueue: invalid payloads are rejected before persistence', async () => {
  const { service, JobModel } = makeService();
  const invalid = [
    null,
    'string',
    [],
    {},
    { email: '', resetToken: 'x', frontendUrl: 'y' },
    { email: 'a@b.c', resetToken: '   ', frontendUrl: 'y' },
    { email: 'a@b.c', resetToken: 'x', frontendUrl: '' },
    { resetToken: 'x', frontendUrl: 'y' },
    { email: 'a@b.c', resetToken: 'x' },
  ];
  for (const payload of invalid) {
    await assert.rejects(() => service.enqueuePasswordReset(payload), JobServiceError);
  }
  assert.equal(JobModel.store.length, 0, 'no invalid job may be persisted');
});

test('claim: atomically moves pending -> processing with lease and attempt count', async () => {
  const { service, JobModel } = makeService();
  const created = await service.enqueuePasswordReset(RESET_PAYLOAD);

  const claimed = await service.claimDueJob(Date.now() + 1_000);
  assert.ok(claimed);
  assert.equal(String(claimed._id), String(created._id));
  assert.equal(claimed.status, 'processing');
  assert.equal(claimed.attempts, 1);
  assert.ok(claimed.leaseUntil instanceof Date);
  assert.ok(claimed.leaseUntil.getTime() > Date.now());
  assert.ok(claimed.startedAt instanceof Date);
  assert.ok(claimed.payload, 'claim must include the encrypted payload');

  // Exactly-once claim: a second concurrent-style claim finds nothing.
  const second = await service.claimDueJob(Date.now() + 1_000);
  assert.equal(second, null);
  assert.equal(JobModel.store[0].attempts, 1, 'attempts must only increment on real claims');
});

test('claim: jobs scheduled in the future are not eligible', async () => {
  const { service } = makeService();
  await service.enqueuePasswordReset(RESET_PAYLOAD);
  const claimed = await service.claimDueJob(Date.now() - 60_000);
  assert.equal(claimed, null);
});

test('markSucceeded: processing -> succeeded with terminal retention', async () => {
  const { service, JobModel } = makeService();
  await service.enqueuePasswordReset(RESET_PAYLOAD);
  const job = await service.claimDueJob(Date.now() + 10);

  const at = Date.now();
  const updated = await service.markSucceeded(job, at);
  assert.ok(updated);
  assert.equal(updated.status, 'succeeded');
  assert.equal(updated.completedAt.getTime(), at);
  assert.equal(updated.expiresAt.getTime(), at + JOB_POLICY.terminalRetentionMs);
  assert.equal(updated.leaseUntil, undefined, 'lease cleared on success');
  assert.ok(updated.startedAt instanceof Date, 'startedAt retained for duration metrics');

  // Guard: transition from a non-processing job is refused.
  const notProcessing = { ...JobModel.store[0], status: 'pending' };
  assert.equal(await service.markSucceeded(notProcessing, at), null);
  assert.equal(JobModel.store[0].status, 'succeeded', 'store unchanged after refused transition');
});

test('scheduleRetry: transient failure returns to pending with bounded backoff', async () => {
  const { service, JobModel } = makeService();
  await service.enqueuePasswordReset(RESET_PAYLOAD);
  const job = await service.claimDueJob(Date.now() + 10);

  const at = Date.now();
  const res = await service.scheduleRetry(job, { category: 'smtp_error', message: 'boom' }, at);
  assert.equal(res.status, 'pending');

  const stored = JobModel.store[0];
  assert.equal(stored.status, 'pending');
  // random()=0 -> lower bound = exp/2 = 15s for attempts=1
  assert.equal(stored.nextAttemptAt.getTime(), at + 15_000);
  assert.equal(stored.errorCategory, 'smtp_error');
  assert.equal(stored.errorMessage, 'boom');
  assert.equal(stored.leaseUntil, undefined);
  assert.equal(stored.startedAt, undefined);
  assert.equal(stored.expiresAt, null, 'retrying jobs are not terminal');

  // Now claimable again after the backoff elapses.
  const reclaimed = await service.claimDueJob(at + 15_000);
  assert.ok(reclaimed);
  assert.equal(reclaimed.attempts, 2);
});

test('scheduleRetry: exhausted attempts become dead (terminal) with sanitized error', async () => {
  const { service, JobModel } = makeService();
  await service.enqueuePasswordReset(RESET_PAYLOAD);
  const job = await service.claimDueJob(Date.now() + 10);
  // Simulate a job on its final attempt (claim already incremented to 5).
  JobModel.store[0].attempts = JOB_POLICY.maxAttempts;

  const at = Date.now();
  const res = await service.scheduleRetry(job, { category: 'smtp_error', message: 'smtp down' }, at);
  assert.equal(res.status, 'dead');

  const stored = JobModel.store[0];
  assert.equal(stored.status, 'dead');
  assert.match(stored.errorMessage, /attempts exhausted: 5\/5/);
  assert.match(stored.errorMessage, /smtp down/);
  assert.equal(stored.expiresAt.getTime(), at + JOB_POLICY.terminalRetentionMs);
  assert.equal(stored.leaseUntil, undefined);
});

test('markDead: guarded, sets retention, refuses illegal source states', async () => {
  const { service, JobModel } = makeService();
  await service.enqueuePasswordReset(RESET_PAYLOAD);
  const job = await service.claimDueJob(Date.now() + 10);

  const at = Date.now();
  const res = await service.markDead(job, { category: 'decryption_failed', message: 'nope' }, at);
  assert.equal(res.status, 'dead');
  assert.equal(JobModel.store[0].status, 'dead');
  assert.equal(JobModel.store[0].errorCategory, 'decryption_failed');
  assert.ok(JobModel.store[0].expiresAt instanceof Date);

  // Refuse dead -> pending style resurrection attempts.
  const res2 = await service.markDead({ ...JobModel.store[0], status: 'dead' }, {}, at);
  assert.equal(res2.status, 'lost');
  const res3 = await service.markSucceeded({ ...JobModel.store[0], status: 'pending' }, at);
  assert.equal(res3, null);
});

test('recoverExpiredLeases: only expired processing jobs are requeued', async () => {
  const { service, JobModel } = makeService();

  // Expired lease (crashed worker).
  const crashed = JobModel.insert({
    type: 'email.password_reset',
    payload: CIPHER.encrypt(RESET_PAYLOAD, EMAIL_JOB_PURPOSE),
    status: 'processing',
    attempts: 1,
    leaseUntil: new Date(Date.now() - 1_000),
    startedAt: new Date(Date.now() - 130_000),
  });
  // Live lease (legitimate in-flight send).
  const live = JobModel.insert({
    type: 'email.password_reset',
    payload: CIPHER.encrypt(RESET_PAYLOAD, EMAIL_JOB_PURPOSE),
    status: 'processing',
    attempts: 1,
    leaseUntil: new Date(Date.now() + 60_000),
    startedAt: new Date(),
  });
  // Untouched pending job.
  const pending = JobModel.insert({
    type: 'email.password_reset',
    payload: CIPHER.encrypt(RESET_PAYLOAD, EMAIL_JOB_PURPOSE),
    status: 'pending',
  });

  const recovered = await service.recoverExpiredLeases(Date.now());
  assert.equal(recovered, 1);
  assert.equal(crashed.status, 'pending');
  assert.equal(crashed.leaseUntil, undefined);
  assert.equal(crashed.attempts, 1, 'recovery does not consume an attempt');
  assert.equal(live.status, 'processing', 'live lease must never be stolen');
  assert.equal(pending.status, 'pending');

  // Requeued crashed job is claimable immediately.
  const claimed = await service.claimDueJob(Date.now());
  assert.equal(String(claimed._id), String(crashed._id));
});

test('getStats: aggregate counts only — no payloads, emails, tokens, or raw errors', async () => {
  const { service, JobModel } = makeService();
  await service.enqueuePasswordReset(RESET_PAYLOAD);
  await service.enqueuePasswordReset({ ...RESET_PAYLOAD, resetToken: crypto.randomBytes(32).toString('hex') });
  await service.claimDueJob(Date.now() + 10);

  const at = Date.now();
  const stats = await service.getStats(at);
  assert.deepEqual(stats.counts, { pending: 1, processing: 1, succeeded: 0, dead: 0, total: 2 });
  assert.equal(stats.queued, 2);
  assert.equal(stats.processingCount, 1);
  assert.equal(stats.deadCount, 0);
  assert.equal(typeof stats.oldestPendingAgeMs, 'number');
  assert.ok(stats.oldestPendingAgeMs >= 0);
  assert.equal(stats.enqueueFailures, 0);

  const serialized = JSON.stringify(stats);
  assert.ok(!serialized.includes('payload'));
  assert.ok(!serialized.includes(RESET_PAYLOAD.resetToken));
  assert.ok(!serialized.includes('@'));

  // Empty database: oldest age is null, never a crash.
  await JobModel.deleteMany({});
  const empty = await service.getStats(Date.now());
  assert.equal(empty.oldestPendingAgeMs, null);
  assert.equal(empty.counts.total, 0);
});

test('noteEnqueueFailure: counts and logs a redacted operational failure', async () => {
  const { service, logs } = makeService();
  const leakyError = new Error(
    `insert failed for token=${'a'.repeat(64)} to victim@example.com via /reset-password/${'b'.repeat(64)}`
  );

  const count1 = service.noteEnqueueFailure(leakyError, 'corr-9');
  const count2 = service.noteEnqueueFailure(new Error('second'), 'corr-9');
  assert.equal(count1, 1);
  assert.equal(count2, 2);
  assert.equal(service.getEnqueueFailures(), 2);

  const allLogs = logs.errors.join('\n');
  assert.ok(allLogs.length > 0);
  assert.ok(!allLogs.includes('a'.repeat(64)), 'raw token must never be logged');
  assert.ok(!allLogs.includes('victim@example.com'), 'email must never be logged');
  assert.ok(!allLogs.includes('b'.repeat(64)), 'reset path token must never be logged');
  assert.match(allLogs, /corr-9/);

  const stats = await service.getStats();
  assert.equal(stats.enqueueFailures, 2);
});

test('stats response shape is stable (documented contract for /debug/jobs)', async () => {
  const { service } = makeService();
  const stats = await service.getStats();
  assert.deepEqual(Object.keys(stats).sort(), [
    'counts',
    'deadCount',
    'enqueueFailures',
    'oldestPendingAgeMs',
    'processingCount',
    'queued',
  ]);
  assert.deepEqual(Object.keys(stats.counts).sort(), ['dead', 'pending', 'processing', 'succeeded', 'total']);
});
