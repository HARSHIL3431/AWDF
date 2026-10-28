/**
 * Central policy constants for the background-job system.
 * All timing/retry values live here so they are explicit, testable, and documented.
 *
 * Validated relationship (see emailWorker.js):
 *   leaseMs (120s) must exceed the worst-case single SMTP operation
 *   connectionTimeout (10s) + greetingTimeout (10s) + socketTimeout (30s) = 50s,
 *   so a job cannot be reclaimed while its worker is legitimately sending.
 */
export const JOB_POLICY = Object.freeze({
  maxAttempts: 5,
  baseRetryDelayMs: 30_000, // 30 seconds
  retryDelayCapMs: 15 * 60_000, // 15 minutes
  pollIntervalMs: 2_000, // 2 seconds
  batchSize: 5,
  leaseMs: 120_000, // 120 seconds
  shutdownMs: 10_000, // graceful shutdown target
  terminalRetentionMs: 7 * 24 * 60 * 60_000, // terminal jobs expire after 7 days
});

export const SMTP_TIMEOUTS = Object.freeze({
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
});

export const EMAIL_JOB_TYPE = 'email.password_reset';

/** AAD purpose binding for encrypted payloads. */
export const EMAIL_JOB_PURPOSE = 'email.password_reset';

/** Process-local rate limit for POST /forgot-password: 5 requests / 15 minutes / IP. */
export const FORGOT_PASSWORD_RATE_LIMIT = Object.freeze({
  max: 5,
  windowMs: 15 * 60_000,
});

/**
 * Exponential backoff with jitter: delay in [exp/2, exp] where
 * exp = min(base * 2^(attempts-1), cap). `random` is injectable for tests.
 */
export function computeBackoffMs(attempts, random = Math.random) {
  const safeAttempts = Number.isFinite(attempts) && attempts >= 1 ? Math.floor(attempts) : 1;
  const exp = Math.min(JOB_POLICY.retryDelayCapMs, JOB_POLICY.baseRetryDelayMs * 2 ** (safeAttempts - 1));
  const half = Math.floor(exp / 2);
  const r = typeof random === 'function' ? random() : Math.random();
  const bounded = r >= 0 && r <= 1 ? r : Math.random();
  return half + Math.floor(bounded * (exp - half));
}
