/**
 * Redaction helpers for logs and operational messages.
 *
 * Guarantees (covered by test/redaction.test.js):
 * - Reset-token path segments (/reset-password/<token>) are never written verbatim.
 * - Sensitive query parameters are masked.
 * - 64-hex strings (raw or SHA-256-hashed reset tokens) are masked in free text.
 * - Email addresses are masked in free text.
 * - Error messages/stacks can be passed through redactText before logging.
 */

const RESET_PATH_PATTERN = /\/reset-password\/[^/?#\s]*/gi;
const HEX64_PATTERN = /\b[0-9a-f]{64}\b/gi;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'password',
  'reset',
  'resettoken',
  'key',
  'secret',
  'auth',
  'authorization',
  'jwt',
  'apikey',
  'accesstoken',
]);

/** Redacts the path segment after /reset-password/ and sensitive query parameter values. */
export function redactUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return '';
  }
  const queryIndex = rawUrl.indexOf('?');
  let path = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : rawUrl.slice(queryIndex);

  path = path.replace(RESET_PATH_PATTERN, '/reset-password/[REDACTED]');

  let redactedQuery = query;
  if (query.length > 0) {
    redactedQuery = query.replace(/([^?=&#]+)=([^&#]*)/g, (match, key) => {
      let decodedKey = key;
      try {
        decodedKey = decodeURIComponent(key);
      } catch {
        decodedKey = key;
      }
      // Normalize (lowercase, strip separators) so API_KEY / api-key / apikey
      // all resolve to the same sensitive-key name.
      const normalized = decodedKey.toLowerCase().replace(/[^a-z0-9]/g, '');
      return SENSITIVE_QUERY_KEYS.has(normalized) ? `${key}=[REDACTED]` : match;
    });
  }

  return path + redactedQuery;
}

/**
 * Redacts sensitive material from free text (error messages, stacks, job errors).
 * Masks: reset-password paths, 64-hex tokens, email addresses.
 */
export function redactText(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return '';
  }
  return text
    .replace(RESET_PATH_PATTERN, '/reset-password/[REDACTED]')
    .replace(HEX64_PATTERN, '[REDACTED_TOKEN]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');
}
