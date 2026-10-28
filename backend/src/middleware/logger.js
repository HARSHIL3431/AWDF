import crypto from 'node:crypto';
import { redactUrl } from '../security/redaction.js';

/**
 * Request logger.
 *
 * - Redacts the reset-password token path segment and sensitive query
 *   parameters BEFORE anything is written (regression-tested in
 *   test/logging.test.js — a known token must never reach log output).
 * - Never logs request bodies (it never did; it still does not).
 * - Adds status code, duration, and a correlation ID (honors a sane
 *   X-Request-Id, otherwise generates one) so a request can be traced to its
 *   background job. Logged on response finish.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export const logger = (req, res, next) => {
  const startedAt = process.hrtime.bigint();

  const incomingRequestId = req.headers?.['x-request-id'];
  req.correlationId =
    typeof incomingRequestId === 'string' && REQUEST_ID_PATTERN.test(incomingRequestId)
      ? incomingRequestId
      : crypto.randomUUID();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const url = redactUrl(req.originalUrl || req.url || '');
    const timestamp = new Date().toISOString().split('.')[0] + 'Z';
    console.log(
      `${req.method} ${url} ${res.statusCode} ${durationMs.toFixed(1)}ms [${req.correlationId}] ${timestamp}`
    );
  });

  next();
};
