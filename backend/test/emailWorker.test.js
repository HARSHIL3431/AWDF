import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createJobService } from '../src/services/jobService.js';
import { createEmailWorker } from '../src/workers/emailWorker.js';
import { createPayloadCipher } from '../src/security/payloadEncryption.js';
import { EMAIL_JOB_PURPOSE, JOB_POLICY, SMTP_TIMEOUTS } from '../src/config/jobConfig.js';
import { createMemoryJobModel } from './helpers/memoryJobModel.js';

const TEST_KEY = crypto.randomBytes(32).toString('hex');
const CIPHER = createPayloadCipher(TEST_KEY);

const PAYLOAD = {
  email: 'worker-recipient@example.com',
  resetToken: crypto.randomBytes(32).toString('hex'),
  frontendUrl: 'http://localhost:5173',
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

function setup({ sendEmail, policy } = {}) {
  const JobModel = createMemoryJobModel();
  const { logger, records } = silentLogger();
  const service = createJobService({ JobModel, cipher: CIPHER, logger, random: () => 0 });
  const calls = [];
  const sender =
    sendEmail ??
    (async (email, token, url) => {
      calls.push({ email, token, url });
      return { success: true };
    });
  const worker = createEmailWorker({
    jobService: service,
    sendEmail: sender,
    cipher: CIPHER,
    policy: policy ?? JOB_POLICY,
    logger,
  });
  return { JobModel, service, worker, calls, records, logger };
}

test('successful delivery: job -> succeeded, sender received the real payload data', async () => {
  const { service, worker, calls, JobModel, records } = setup();
  await service.enqueuePasswordReset(PAYLOAD);

  await worker.runOnce();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].email, PAYLOAD.email);
  assert.equal(calls[0].token, PAYLOAD.resetToken);
  assert.equal(calls[0].url, PAYLOAD.frontendUrl);

  const job = JobModel.store[0];
  assert.equal(job.status, 'succeeded');
  assert.ok(job.completedAt instanceof Date);
  assert.ok(job.expiresAt instanceof Date, 'terminal job gets retention expiry');
  assert.ok(records.logs.some((l) => l.includes('outcome=succeeded')));
});

test('retryable email failure: {success:false} (no throw) schedules a retry', async () => {
  const { service, worker, JobModel } = setup({
    sendEmail: async () => ({ success: false, error: 'SMTP connection timed out' }),
  });
  await service.enqueuePasswordReset(PAYLOAD);

  await worker.runOnce();

  const job = JobModel.store[0];
  assert.equal(job.status, 'pending');
  assert.equal(job.attempts, 1);
  assert.equal(job.errorCategory, 'smtp_error');
  assert.match(job.errorMessage, /SMTP connection timed out/);
  assert.ok(job.nextAttemptAt.getTime() > Date.now(), 'retry is deferred');
  assert.equal(job.leaseUntil, undefined);
});

test('sender throwing is treated as retryable and never kills the loop', async () => {
  const { service, worker, JobModel } = setup({
    sendEmail: async () => {
      throw new Error('unexpected sync failure');
    },
  });
  await service.enqueuePasswordReset(PAYLOAD);

  await worker.runOnce(); // must not reject

  const job = JobModel.store[0];
  assert.equal(job.status, 'pending');
  assert.equal(job.errorCategory, 'send_exception');
  assert.equal(job.attempts, 1);
});

test('worker continues past a failed job and processes the next one', async () => {
  const { service, worker, JobModel } = setup({
    sendEmail: async (email) => {
      if (email === 'first@example.com') {
        return { success: false, error: 'relay rejected' };
      }
      return { success: true };
    },
  });
  await service.enqueuePasswordReset({ ...PAYLOAD, email: 'first@example.com' });
  await service.enqueuePasswordReset({ ...PAYLOAD, email: 'second@example.com' });

  await worker.runOnce();

  assert.equal(JobModel.store[0].status, 'pending', 'first job scheduled for retry');
  assert.equal(JobModel.store[1].status, 'succeeded', 'second job still processed');
});

test('exhausted job moves to dead after max attempts', async () => {
  const { service, worker, JobModel } = setup({
    sendEmail: async () => ({ success: false, error: 'permanently rejected' }),
  });
  await service.enqueuePasswordReset(PAYLOAD);
  // Simulate a job entering its final attempt (claim will increment to 5).
  JobModel.store[0].attempts = JOB_POLICY.maxAttempts - 1;
  JobModel.store[0].nextAttemptAt = new Date(Date.now() - 1_000);

  await worker.runOnce();

  const job = JobModel.store[0];
  assert.equal(job.status, 'dead');
  assert.equal(job.attempts, JOB_POLICY.maxAttempts);
  assert.match(job.errorMessage, /attempts exhausted/);
  assert.ok(job.expiresAt instanceof Date);
});

test('invalid decrypted payload: dead without calling the sender', async () => {
  const { worker, calls, JobModel } = setup();
  JobModel.insert({
    type: 'email.password_reset',
    payload: CIPHER.encrypt({ email: 'someone@example.com' }, EMAIL_JOB_PURPOSE), // missing fields
    status: 'pending',
  });

  await worker.runOnce();

  assert.equal(calls.length, 0, 'sender must not be called for invalid payload');
  const job = JobModel.store[0];
  assert.equal(job.status, 'dead');
  assert.equal(job.errorCategory, 'invalid_payload');
});

test('undecryptable payload (wrong key): dead without calling the sender', async () => {
  const { worker, calls, JobModel } = setup();
  const wrongCipher = createPayloadCipher(crypto.randomBytes(32).toString('hex'));
  JobModel.insert({
    type: 'email.password_reset',
    payload: wrongCipher.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE),
    status: 'pending',
  });

  await worker.runOnce();

  assert.equal(calls.length, 0);
  assert.equal(JobModel.store[0].status, 'dead');
  assert.equal(JobModel.store[0].errorCategory, 'decryption_failed');
});

test('unsupported job type: dead, sender untouched', async () => {
  const { worker, calls, JobModel } = setup();
  JobModel.insert({
    type: 'email.welcome',
    payload: CIPHER.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE),
    status: 'pending',
  });

  await worker.runOnce();

  assert.equal(calls.length, 0);
  assert.equal(JobModel.store[0].status, 'dead');
  assert.equal(JobModel.store[0].errorCategory, 'unsupported_type');
});

test('concurrent cycles cannot double-claim the same job (atomic claim)', async () => {
  const { service, worker, calls, JobModel } = setup();
  await service.enqueuePasswordReset(PAYLOAD);

  await Promise.all([worker.runOnce(), worker.runOnce()]);

  assert.equal(calls.length, 1, 'exactly one send across overlapping cycles');
  assert.equal(JobModel.store[0].status, 'succeeded');
});

test('crash recovery: expired processing lease is reclaimed and the job re-sent', async () => {
  const { worker, calls, JobModel } = setup();
  JobModel.insert({
    type: 'email.password_reset',
    payload: CIPHER.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE),
    status: 'processing',
    attempts: 1,
    leaseUntil: new Date(Date.now() - 1_000), // crashed mid-send long ago
    startedAt: new Date(Date.now() - 130_000),
  });

  await worker.runOnce();

  assert.equal(calls.length, 1, 'recovered job delivered (at-least-once resend)');
  const job = JobModel.store[0];
  assert.equal(job.status, 'succeeded');
  assert.equal(job.attempts, 2);
});

test('lease safety: a live processing job is not touched while its lease holds', async () => {
  const { worker, calls, JobModel } = setup();
  JobModel.insert({
    type: 'email.password_reset',
    payload: CIPHER.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE),
    status: 'processing',
    attempts: 1,
    leaseUntil: new Date(Date.now() + 60_000),
    startedAt: new Date(),
  });

  await worker.runOnce();

  assert.equal(calls.length, 0, 'no duplicate send under a live lease');
  assert.equal(JobModel.store[0].status, 'processing');
});

test('start is idempotent: a second start does not create a second loop', async () => {
  const { worker, service, calls } = setup({
    policy: { ...JOB_POLICY, pollIntervalMs: 30 },
  });
  try {
    assert.equal(worker.start(), true);
    assert.equal(worker.start(), false, 'second start must be a no-op');
    assert.equal(worker.isRunning(), true);

    await service.enqueuePasswordReset(PAYLOAD);
    await new Promise((r) => setTimeout(r, 150)); // let the single loop claim it
    assert.equal(calls.length, 1);

    // A duplicate loop would claim again as new jobs appear; assert single handling.
    await service.enqueuePasswordReset(PAYLOAD);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(calls.length, 2, 'one job per cycle from the single loop');
  } finally {
    await worker.stop(2_000);
  }
  assert.equal(worker.isRunning(), false);
});

test('graceful shutdown: stop halts new claims and resolves quickly when idle', async () => {
  const { worker, service, JobModel } = setup({
    policy: { ...JOB_POLICY, pollIntervalMs: 30 },
  });
  worker.start();
  await new Promise((r) => setTimeout(r, 50));

  const result = await worker.stop(5_000);
  assert.equal(result.stopped, true);
  assert.equal(result.drained, true);
  assert.equal(worker.isRunning(), false);

  // After stop: no loop remains to claim new work.
  await service.enqueuePasswordReset(PAYLOAD);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(JobModel.store[0].status, 'pending', 'stopped worker must not claim');
});

test('shutdown drains an in-flight job within the window', async () => {
  let releaseSend;
  const gate = new Promise((r) => {
    releaseSend = r;
  });
  const { worker, service, JobModel } = setup({
    sendEmail: async () => {
      await gate;
      return { success: true };
    },
    policy: { ...JOB_POLICY, pollIntervalMs: 30 },
  });

  await service.enqueuePasswordReset(PAYLOAD);
  worker.start();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(worker.isProcessing(), true, 'job is in flight');

  const stopPromise = worker.stop(5_000);
  await new Promise((r) => setTimeout(r, 30));
  releaseSend(); // finish within the window
  const result = await stopPromise;

  assert.equal(result.drained, true, 'in-flight job finished before the deadline');
  assert.equal(JobModel.store[0].status, 'succeeded');
});

test('shutdown timeout: undrained stop leaves the job recoverable, not lost', async () => {
  const { worker, service, JobModel, logger } = setup({
    sendEmail: () => new Promise(() => {}), // never resolves (simulates stuck send)
    policy: { ...JOB_POLICY, pollIntervalMs: 30 },
  });

  await service.enqueuePasswordReset(PAYLOAD);
  worker.start();
  await new Promise((r) => setTimeout(r, 80));

  const result = await worker.stop(150);
  assert.equal(result.stopped, true);
  assert.equal(result.drained, false, 'stuck job could not drain in time');

  // Job remains 'processing' with its lease -> recoverable on next start.
  const job = JobModel.store[0];
  assert.equal(job.status, 'processing');
  assert.ok(job.leaseUntil instanceof Date && job.leaseUntil.getTime() > Date.now());

  // Simulated restart: lease expires; a fresh worker on the same store
  // reclaims it and completes delivery (at-least-once recovery).
  job.leaseUntil = new Date(Date.now() - 1);
  const recoveredWorker = createEmailWorker({
    jobService: service,
    sendEmail: async () => ({ success: true }),
    cipher: CIPHER,
    policy: JOB_POLICY,
    logger,
  });
  await recoveredWorker.runOnce();
  assert.equal(JobModel.store[0].status, 'succeeded', 'expired lease reclaimed and completed');
  assert.equal(JobModel.store[0].attempts, 2);
});

test('invalid policy: lease below worst-case SMTP time is rejected at construction', () => {
  assert.throws(() =>
    createEmailWorker({
      jobService: { recoverExpiredLeases: async () => 0 },
      policy: {
        ...JOB_POLICY,
        leaseMs:
          SMTP_TIMEOUTS.connectionTimeout + SMTP_TIMEOUTS.greetingTimeout + SMTP_TIMEOUTS.socketTimeout,
      },
    })
  );
});

test('importing the worker module starts no timers or loops', async () => {
  const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  await import(`../src/workers/emailWorker.js?import-safety=${Date.now()}`);
  const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  assert.equal(after, before, 'module import must be side-effect free');
});
