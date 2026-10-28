import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { connectTestDb, disconnectTestDb, wipeIsolatedData } from '../helpers/testDb.js';
import Job from '../../src/models/jobModel.js';
import { createJobService } from '../../src/services/jobService.js';
import { getPayloadCipher } from '../../src/security/payloadEncryption.js';

/**
 * Integration: atomic claim semantics against real MongoDB.
 * These tests prove that concurrent guarded findOneAndUpdate operations can
 * never double-claim or double-transition a job.
 */

if (!process.env.JOB_PAYLOAD_ENCRYPTION_KEY) {
  process.env.JOB_PAYLOAD_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
}
const CIPHER = getPayloadCipher();

const PAYLOAD = {
  email: 'it-atomicity@example.com',
  resetToken: crypto.randomBytes(32).toString('hex'),
  frontendUrl: 'http://localhost:5173',
};

let service;

before(async () => {
  await connectTestDb();
  await Job.init();
  service = createJobService({ cipher: CIPHER });
});

after(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await wipeIsolatedData(['jobs', 'users']);
});

test('atomic claim: 12 concurrent claims win exactly once per due job (5 jobs)', async () => {
  for (let i = 0; i < 5; i += 1) {
    await service.enqueuePasswordReset({ ...PAYLOAD, email: `it-atomic-${i}@example.com` });
  }

  const results = await Promise.all(
    Array.from({ length: 12 }, () => service.claimDueJob(Date.now() + 1_000))
  );
  const winners = results.filter((r) => r !== null);
  const winnersIds = new Set(winners.map((w) => String(w._id)));

  assert.equal(winners.length, 5, 'exactly one claim per job');
  assert.equal(winnersIds.size, 5, 'no job claimed twice');
  for (const w of winners) assert.equal(w.attempts, 1, 'attempt counted exactly once');

  const processing = await Job.find({ status: 'processing' });
  assert.equal(processing.length, 5);
  for (const doc of processing) {
    assert.equal(doc.attempts, 1);
  }
  assert.equal(await Job.countDocuments({ status: 'pending' }), 0);
});

test('atomic transition: concurrent markSucceeded — exactly one wins', async () => {
  await service.enqueuePasswordReset(PAYLOAD);
  const claimed = await service.claimDueJob(Date.now() + 1_000);

  const results = await Promise.all([
    service.markSucceeded(claimed, Date.now()),
    service.markSucceeded(claimed, Date.now()),
  ]);
  const wins = results.filter((r) => r !== null);
  assert.equal(wins.length, 1, 'only one completion may win the guarded update');

  const stored = await Job.findById(claimed._id);
  assert.equal(stored.status, 'succeeded');
  assert.equal(stored.attempts, 1);
});

test('atomic retry: concurrent scheduleRetry — one requeues, the other reports lost', async () => {
  await service.enqueuePasswordReset(PAYLOAD);
  const claimed = await service.claimDueJob(Date.now() + 1_000);

  const results = await Promise.all([
    service.scheduleRetry(claimed, { category: 'smtp_error', message: 'a' }, Date.now()),
    service.scheduleRetry(claimed, { category: 'smtp_error', message: 'b' }, Date.now()),
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, ['lost', 'pending'], 'exactly one retry may win');

  const stored = await Job.findById(claimed._id);
  assert.equal(stored.status, 'pending');
  assert.equal(stored.attempts, 1, 'a lost duplicate must not double-count attempts');
});

test('guard: a job cannot be claimed again from terminal or processing states', async () => {
  await service.enqueuePasswordReset(PAYLOAD);
  const claimed = await service.claimDueJob(Date.now() + 1_000);
  await service.markSucceeded(claimed, Date.now());

  // Succeeded job: not claimable even if nextAttemptAt would match.
  await Job.updateOne({ _id: claimed._id }, { $set: { nextAttemptAt: new Date(Date.now() - 1_000) } });
  assert.equal(await service.claimDueJob(Date.now() + 1_000), null);

  // Processing job under a live lease: not claimable.
  const second = await service.enqueuePasswordReset(PAYLOAD);
  const claimed2 = await service.claimDueJob(Date.now() + 1_000);
  assert.equal(String(claimed2._id), String(second._id));
  assert.equal(await service.claimDueJob(Date.now() + 1_000), null, 'live lease blocks re-claim');
});

test('claim ordering: oldest due job first', async () => {
  const base = Date.now() - 10_000;
  const older = await service.enqueuePasswordReset(PAYLOAD);
  await Job.updateOne({ _id: older._id }, { $set: { nextAttemptAt: new Date(base) } });
  const newer = await service.enqueuePasswordReset(PAYLOAD);
  await Job.updateOne({ _id: newer._id }, { $set: { nextAttemptAt: new Date(base + 5_000) } });

  const first = await service.claimDueJob(Date.now());
  assert.equal(String(first._id), String(older._id), 'oldest due job must be claimed first');
  const second = await service.claimDueJob(Date.now());
  assert.equal(String(second._id), String(newer._id));
});
