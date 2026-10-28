import test from 'node:test';
import assert from 'node:assert/strict';
import Job, { JOB_STATUSES, canTransition } from '../src/models/jobModel.js';
import { computeBackoffMs, JOB_POLICY, SMTP_TIMEOUTS, FORGOT_PASSWORD_RATE_LIMIT } from '../src/config/jobConfig.js';

const VALID_ENVELOPE = { v: 1, iv: 'AAAAAAAAAAAAAAAA', tag: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', ct: 'AAAA' };

function baseDoc(overrides = {}) {
  return {
    type: 'email.password_reset',
    payload: { ...VALID_ENVELOPE },
    nextAttemptAt: new Date(),
    ...overrides,
  };
}

test('valid job document passes schema validation', () => {
  const doc = new Job(baseDoc());
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.status, 'pending');
  assert.equal(doc.attempts, 0);
  assert.equal(doc.maxAttempts, JOB_POLICY.maxAttempts);
});

test('schema rejects missing/invalid type', () => {
  assert.match(new Job(baseDoc({ type: undefined })).validateSync().message, /required/i);
  assert.match(new Job(baseDoc({ type: 'email.welcome' })).validateSync().message, /Unsupported job type/);
});

test('schema rejects invalid status values', () => {
  assert.match(new Job(baseDoc({ status: 'failed' })).validateSync().message, /Invalid job status/);
  for (const status of JOB_STATUSES) {
    assert.equal(new Job(baseDoc({ status })).validateSync(), undefined);
  }
});

test('schema rejects missing payload and negative attempts', () => {
  const noPayload = new Job(baseDoc());
  noPayload.payload = undefined;
  assert.match(noPayload.validateSync().message, /Encrypted payload is required/);
  assert.match(new Job(baseDoc({ attempts: -1 })).validateSync().message, /cannot be negative/);
});

test('payload is select:false and never serialized by toJSON', () => {
  assert.equal(Job.schema.path('payload').options.select, false);
  const doc = new Job(baseDoc());
  const json = JSON.stringify(doc.toJSON());
  assert.ok(!json.includes('"payload"'));
  assert.ok(!json.includes(VALID_ENVELOPE.iv));
});

test('indexes cover claim, lease recovery, and terminal TTL', () => {
  const indexes = Job.schema.indexes();
  const hasIndex = (keys, extra = {}) =>
    indexes.some(([keyDef, opts]) => {
      const entries = Object.entries(keyDef);
      return (
        entries.length === Object.keys(keys).length &&
        entries.every(([k, v]) => keys[k] === v) &&
        Object.entries(extra).every(([k, v]) => opts?.[k] === v)
      );
    });

  assert.ok(hasIndex({ status: 1, nextAttemptAt: 1 }), 'claim index missing');
  assert.ok(hasIndex({ status: 1, leaseUntil: 1 }), 'lease-recovery index missing');
  assert.ok(hasIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }), 'TTL index missing');
});

test('legal lifecycle transitions only', () => {
  assert.equal(canTransition('pending', 'processing'), true);
  assert.equal(canTransition('processing', 'succeeded'), true);
  assert.equal(canTransition('processing', 'pending'), true);
  assert.equal(canTransition('processing', 'dead'), true);

  assert.equal(canTransition('pending', 'succeeded'), false);
  assert.equal(canTransition('pending', 'dead'), false);
  assert.equal(canTransition('succeeded', 'pending'), false);
  assert.equal(canTransition('succeeded', 'dead'), false);
  assert.equal(canTransition('dead', 'pending'), false);
  assert.equal(canTransition('dead', 'succeeded'), false);
  assert.equal(canTransition(undefined, 'processing'), false);
  assert.equal(canTransition('processing', 'processing'), false);
});

test('retry policy constants match the approved values', () => {
  assert.equal(JOB_POLICY.maxAttempts, 5);
  assert.equal(JOB_POLICY.baseRetryDelayMs, 30_000);
  assert.equal(JOB_POLICY.retryDelayCapMs, 15 * 60_000);
  assert.equal(JOB_POLICY.pollIntervalMs, 2_000);
  assert.equal(JOB_POLICY.batchSize, 5);
  assert.equal(JOB_POLICY.leaseMs, 120_000);
  assert.equal(JOB_POLICY.shutdownMs, 10_000);

  // Lease must exceed worst-case single SMTP operation (bounded timeouts).
  const smtpWorst =
    SMTP_TIMEOUTS.connectionTimeout + SMTP_TIMEOUTS.greetingTimeout + SMTP_TIMEOUTS.socketTimeout;
  assert.equal(smtpWorst, 50_000);
  assert.ok(JOB_POLICY.leaseMs > smtpWorst);

  assert.equal(FORGOT_PASSWORD_RATE_LIMIT.max, 5);
  assert.equal(FORGOT_PASSWORD_RATE_LIMIT.windowMs, 15 * 60_000);
});

test('backoff: exponential growth with jitter inside [exp/2, exp], capped', () => {
  // random fixed at 0 -> lower bound exp/2
  assert.equal(computeBackoffMs(1, () => 0), 15_000);
  assert.equal(computeBackoffMs(2, () => 0), 30_000); // 60s exp -> 30s half
  assert.equal(computeBackoffMs(3, () => 0), 60_000); // 120s exp -> 60s half

  // random fixed near 1 -> upper bound ~exp
  const near1 = () => 0.9999999;
  assert.ok(computeBackoffMs(1, near1) >= 29_999);
  assert.ok(computeBackoffMs(1, near1) <= 30_000);

  // cap: attempts 6 -> exp would be 960s, capped to 900s -> [450s, 900s]
  const low6 = computeBackoffMs(6, () => 0);
  const high6 = computeBackoffMs(6, near1);
  assert.equal(low6, 450_000);
  assert.ok(high6 <= 900_000);

  // attempts below 1 normalize to 1; non-function random tolerated
  assert.equal(computeBackoffMs(0, () => 0), 15_000);
  assert.equal(computeBackoffMs(-5, () => 0), 15_000);

  // jitter varies within bounds for arbitrary randoms
  for (const r of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const d = computeBackoffMs(1, () => r);
    assert.ok(d >= 15_000 && d <= 30_000, `delay ${d} out of bounds for r=${r}`);
  }
});
