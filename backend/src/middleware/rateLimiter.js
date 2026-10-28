import { FORGOT_PASSWORD_RATE_LIMIT } from '../config/jobConfig.js';

/**
 * Process-local fixed-window rate limiter for POST /forgot-password.
 *
 * Limit: FORGOT_PASSWORD_RATE_LIMIT.max requests per windowMs per client IP.
 *
 * Keying: the TCP socket remote address (req.socket.remoteAddress).
 * X-Forwarded-For is deliberately NOT consulted — Express `trust proxy` is not
 * configured in this application, so forwarding headers would be spoofable.
 * If this app is ever placed behind a reverse proxy, `trust proxy` must be
 * configured deliberately and this choice revisited.
 *
 * Known limitations (documented in README): counters are per-process, reset on
 * restart, and are not shared across instances. This is not distributed rate
 * limiting. The map is bounded to maxSize keys with oldest-first eviction.
 *
 * Enumeration safety: the limiter keys only on the client address — never on
 * the submitted email — and runs before the handler, so accepted and rejected
 * responses do not leak whether an account exists.
 */

export function createRateLimiter({
  max = FORGOT_PASSWORD_RATE_LIMIT.max,
  windowMs = FORGOT_PASSWORD_RATE_LIMIT.windowMs,
  now = () => Date.now(),
  maxSize = 10_000,
} = {}) {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error('Rate limiter max must be a positive integer.');
  }
  if (!Number.isInteger(windowMs) || windowMs < 1) {
    throw new Error('Rate limiter windowMs must be a positive integer.');
  }

  /** key -> array of request timestamps inside the window */
  const buckets = new Map();

  function prune(timestamps, at) {
    const cutoff = at - windowMs;
    let i = 0;
    while (i < timestamps.length && timestamps[i] <= cutoff) {
      i += 1;
    }
    return i > 0 ? timestamps.slice(i) : timestamps;
  }

  function evictIfNeeded(at) {
    if (buckets.size <= maxSize) {
      return;
    }
    for (const [key, timestamps] of buckets) {
      if (prune(timestamps, at).length === 0) {
        buckets.delete(key);
      }
      if (buckets.size <= maxSize) {
        return;
      }
    }
    // Still full of live buckets: drop oldest-inserted keys (bounded memory).
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (buckets.size <= maxSize) {
        return;
      }
    }
  }

  return function rateLimit(req, res, next) {
    try {
      const key = String(req.socket?.remoteAddress ?? 'unknown');
      const at = now();

      const existing = buckets.get(key);
      const timestamps = existing === undefined ? [] : prune(existing, at);

      if (timestamps.length >= max) {
        const oldest = timestamps[0];
        const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - at) / 1000));
        res.setHeader('Retry-After', String(retryAfterSec));
        return res.status(429).json({
          error: 'Too many requests. Please try again later.',
        });
      }

      timestamps.push(at);
      buckets.set(key, timestamps);
      evictIfNeeded(at);
      return next();
    } catch (err) {
      // Fail open on limiter errors so the endpoint is never bricked by the
      // guard itself; the error is still visible to the operator.
      console.error('[rate-limit] limiter error:', err?.name ?? 'Error');
      return next();
    }
  };
}

/** Application limiter: 5 forgot-password requests / 15 minutes / IP. */
export const forgotPasswordRateLimiter = createRateLimiter();
