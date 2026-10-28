import { createHash } from 'node:crypto';

/**
 * Practical 13 — process-local, per-task rate limit for POST
 * /api/ai/generate-description. Isolated to the AI endpoint: the existing
 * (uncommitted) forgot-password limiter is keyed by client IP and cannot be
 * reused here — see the limitation note in docs/practical-13-ai-integration.md.
 *
 * Limits
 *   - 1 request per task key per 60 s  (the practical's supplementary limit)
 *   - 10 requests per authenticated principal per 60 s  (cost guard, so an
 *     authenticated caller cannot mint unlimited distinct keys to spend quota)
 *
 * Keying — the form creates tasks that have no persistent id yet, so the key
 * is derived from the request instead of inventing a schema field:
 *
 *   task key = sha256(principal + NUL + normalized title)
 *   user key = sha256(principal)
 *
 * where principal is req.user.id (set by authenticateToken, which runs first)
 * and falls back to the socket address if the token carried no id. Both digests
 * are hashed, so neither the title nor the user id is retained in memory; the
 * title is normalized and capped before hashing so a long title cannot build an
 * oversized key.
 *
 * Bounded: at most `maxSize` buckets, pruned on access and evicted oldest-first
 * when full, so memory cannot grow without limit.
 *
 * Honest scope: counters are per-process, reset on restart and are NOT shared
 * across instances. This is not distributed rate limiting. The clock is
 * injectable so tests never wait out the real window.
 */

const DEFAULT_TASK_MAX = 1;
const DEFAULT_TASK_WINDOW_MS = 60_000;
const DEFAULT_USER_MAX = 10;
const DEFAULT_USER_WINDOW_MS = 60_000;
const DEFAULT_MAX_SIZE = 5_000;
const KEY_TITLE_LIMIT = 200;

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}

function normalizeTitle(title) {
  if (typeof title !== 'string') return '';
  const collapsed = title.trim().replace(/\s+/g, ' ');
  if (!collapsed) return '';
  return collapsed.length > KEY_TITLE_LIMIT ? collapsed.slice(0, KEY_TITLE_LIMIT) : collapsed;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

export function createAiRateLimiter({
  taskMax = DEFAULT_TASK_MAX,
  taskWindowMs = DEFAULT_TASK_WINDOW_MS,
  userMax = DEFAULT_USER_MAX,
  userWindowMs = DEFAULT_USER_WINDOW_MS,
  now = () => Date.now(),
  maxSize = DEFAULT_MAX_SIZE,
} = {}) {
  if (!isPositiveInteger(taskMax)) throw new Error('AI rate limiter taskMax must be a positive integer.');
  if (!isPositiveInteger(taskWindowMs)) throw new Error('AI rate limiter taskWindowMs must be a positive integer.');
  if (!isPositiveInteger(userMax)) throw new Error('AI rate limiter userMax must be a positive integer.');
  if (!isPositiveInteger(userWindowMs)) throw new Error('AI rate limiter userWindowMs must be a positive integer.');
  if (!isPositiveInteger(maxSize)) throw new Error('AI rate limiter maxSize must be a positive integer.');

  /** key -> array of timestamps still inside its window */
  const buckets = new Map();

  function prune(timestamps, at, windowMs) {
    const cutoff = at - windowMs;
    let i = 0;
    while (i < timestamps.length && timestamps[i] <= cutoff) {
      i += 1;
    }
    return i > 0 ? timestamps.slice(i) : timestamps;
  }

  /** Read the current (already pruned) timestamps for a key. */
  function peek(key, at, windowMs) {
    const existing = buckets.get(key);
    if (existing === undefined) return [];
    const stamps = prune(existing, at, windowMs);
    buckets.set(key, stamps);
    return stamps;
  }

  function evictIfNeeded(at) {
    if (buckets.size <= maxSize) return;
    for (const [key, stamps] of buckets) {
      if (stamps.length === 0) {
        buckets.delete(key);
      }
      if (buckets.size <= maxSize) return;
    }
    // Every bucket still holds live requests: drop the oldest-inserted keys.
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (buckets.size <= maxSize) return;
    }
  }

  function retryAfterSeconds(oldest, windowMs, at) {
    return Math.max(1, Math.ceil((oldest + windowMs - at) / 1000));
  }

  const middleware = function aiRateLimit(req, res, next) {
    try {
      const title = normalizeTitle(req.body?.title);
      // No usable title: say nothing and let the controller return its 400.
      // Quota is not consumed by a request that was never valid.
      if (!title) return next();

      const at = now();
      const principal = req.user?.id ?? req.user?.sub ?? req.socket?.remoteAddress ?? 'unknown';

      const taskKey = `t:${digest(`${principal}\u0000${title}`)}`;
      const userKey = `u:${digest(principal)}`;

      const taskStamps = peek(taskKey, at, taskWindowMs);
      if (taskStamps.length >= taskMax) {
        res.setHeader('Retry-After', String(retryAfterSeconds(taskStamps[0], taskWindowMs, at)));
        return res.status(429).json({
          error: 'An AI suggestion for this task was already generated. Try again in about a minute.',
        });
      }

      const userStamps = peek(userKey, at, userWindowMs);
      if (userStamps.length >= userMax) {
        res.setHeader('Retry-After', String(retryAfterSeconds(userStamps[0], userWindowMs, at)));
        return res.status(429).json({
          error: 'Too many AI requests. Please wait a minute before trying again.',
        });
      }

      buckets.set(taskKey, [...taskStamps, at]);
      buckets.set(userKey, [...userStamps, at]);
      evictIfNeeded(at);
      return next();
    } catch (err) {
      // Fail open so a limiter bug can never brick the endpoint; only the
      // error NAME is logged — never the request body or any key material.
      console.error('[ai-rate-limit] limiter error:', err?.name ?? 'Error');
      return next();
    }
  };

  /**
   * Diagnostics hook (not part of the Express middleware contract): lets the
   * test suite assert that the bucket map really is capped at `maxSize` under
   * key churn, instead of taking the bound on trust.
   */
  middleware.stats = () => ({ size: buckets.size, maxSize });

  return middleware;
}

/** Application limiter used by the AI route. */
export const aiRateLimiter = createAiRateLimiter();
