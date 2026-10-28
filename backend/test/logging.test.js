import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { redactUrl, redactText } from '../src/security/redaction.js';
import { logger } from '../src/middleware/logger.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const KNOWN_TOKEN = crypto.randomBytes(32).toString('hex'); // 64 hex chars
const KNOWN_EMAIL = 'leaky.user@example.com';

function captureConsole(t, method) {
  const captured = [];
  t.mock.method(console, method, (...args) => {
    captured.push(args.map((a) => (a instanceof Error ? `${a.message}` : String(a))).join(' '));
  });
  return captured;
}

function runLogger(req) {
  let onFinish = null;
  const res = {
    statusCode: 200,
    on(event, cb) {
      if (event === 'finish') onFinish = cb;
    },
  };
  let nextCalled = false;
  logger(req, res, () => {
    nextCalled = true;
  });
  assert.ok(nextCalled, 'logger must call next() synchronously');
  assert.ok(onFinish, 'logger registers a finish listener');
  onFinish();
  return { correlationId: req.correlationId };
}

test('redactUrl: reset-password path segment is redacted', () => {
  const url = `/reset-password/${KNOWN_TOKEN}`;
  const redacted = redactUrl(url);
  assert.ok(!redacted.includes(KNOWN_TOKEN));
  assert.equal(redacted, '/reset-password/[REDACTED]');

  // embedded in a larger URL and with a query string
  const complex = `/api/v1/reset-password/${KNOWN_TOKEN}?next=/home`;
  const out = redactUrl(complex);
  assert.ok(!out.includes(KNOWN_TOKEN));
  assert.match(out, /^\/api\/v1\/reset-password\/\[REDACTED\]\?next=\/home$/);
});

test('redactUrl: sensitive query parameters are masked, others preserved', () => {
  assert.equal(redactUrl('/tasks?page=2&limit=10'), '/tasks?page=2&limit=10');
  assert.equal(redactUrl('/x?token=abc123&page=3'), '/x?token=[REDACTED]&page=3');
  assert.equal(redactUrl('/x?password=hunter2'), '/x?password=[REDACTED]');
  assert.equal(redactUrl('/x?API_KEY=zzz'), '/x?API_KEY=[REDACTED]');
  assert.equal(redactUrl('/x?Authorization=Bearer%20zzz'), '/x?Authorization=[REDACTED]');
  assert.ok(!redactUrl('/x?resetToken=zzz').includes('zzz'));
});

test('redactUrl: malformed and unusual URLs never throw', () => {
  for (const weird of ['', '?', '??', '/%E0%A4%A', '/reset-password/', '?token=', '%%%', '/a?b=%zz&token=x']) {
    assert.doesNotThrow(() => redactUrl(weird));
  }
  assert.equal(redactUrl(undefined), '');
  assert.equal(redactUrl(null), '');
});

test('redactText: hex tokens, emails, and reset paths are masked in free text', () => {
  const BARE_TOKEN = crypto.randomBytes(32).toString('hex'); // not in any path
  const msg = `send to ${KNOWN_EMAIL} via /reset-password/${KNOWN_TOKEN} failed; retry token ${BARE_TOKEN}`;
  const out = redactText(msg);
  assert.ok(!out.includes(KNOWN_TOKEN));
  assert.ok(!out.includes(BARE_TOKEN), 'standalone token masked by the hex rule');
  assert.ok(!out.includes(KNOWN_EMAIL));
  assert.match(out, /\[REDACTED_TOKEN\]/);
  assert.match(out, /\[REDACTED_EMAIL\]/);
  assert.match(out, /\/reset-password\/\[REDACTED\]/);
  // harmless text survives
  assert.equal(redactText('connection timed out'), 'connection timed out');
  assert.equal(redactText(''), '');
  assert.equal(redactText(undefined), '');
});

test('logger never writes a raw reset token, even for a real reset request', (t) => {
  const lines = captureConsole(t, 'log');
  const { correlationId } = runLogger({
    method: 'POST',
    originalUrl: `/reset-password/${KNOWN_TOKEN}`,
    url: `/reset-password/${KNOWN_TOKEN}`,
    headers: {},
  });

  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.ok(!line.includes(KNOWN_TOKEN), 'token must never reach logs');
  assert.match(line, /POST \/reset-password\/\[REDACTED\]/);
  assert.match(line, / 200 /, 'status retained');
  assert.match(line, /ms \[/, 'duration and correlation retained');
  assert.equal(typeof correlationId, 'string');
  assert.ok(correlationId.length > 0);
  assert.ok(!line.includes(KNOWN_TOKEN));
});

test('logger masks sensitive query params and keeps normal routes useful', (t) => {
  const lines = captureConsole(t, 'log');
  runLogger({ method: 'GET', originalUrl: '/tasks?page=2&token=s3cret', headers: {} });
  runLogger({ method: 'GET', originalUrl: '/tasks?page=2', headers: {} });

  assert.equal(lines.length, 2);
  assert.ok(!lines[0].includes('s3cret'), 'query token masked');
  assert.match(lines[0], /token=\[REDACTED\]/);
  assert.match(lines[1], /GET \/tasks\?page=2 200 \d+\.\d{1,2}ms \[[^\]]+\]/);
});

test('logger honors a well-formed X-Request-Id and rejects hostile values', (t) => {
  const lines = captureConsole(t, 'log');
  const good = runLogger({
    method: 'GET',
    originalUrl: '/me',
    headers: { 'x-request-id': 'req-abc_123.9' },
  });
  const evil = runLogger({
    method: 'GET',
    originalUrl: '/me',
    headers: { 'x-request-id': 'bad id with spaces\nand newline <script>' },
  });

  assert.equal(good.correlationId, 'req-abc_123.9', 'sane client id honored');
  assert.notEqual(evil.correlationId, 'bad id with spaces\nand newline <script>', 'hostile id replaced');
  assert.match(evil.correlationId, /^[0-9a-f-]{36}$/);
  assert.ok(lines.every((l) => !l.includes('<script>')));
});

test('error handler logs are redacted (token in error message/stack never printed)', (t) => {
  const lines = captureConsole(t, 'error');
  const err = new Error(`lookup failed token=${KNOWN_TOKEN} recipient=${KNOWN_EMAIL}`);
  err.stack = `Error: lookup failed token=${KNOWN_TOKEN}\n    at foo (/app/reset.js:1:1)`;

  const res = {
    statusCode: null,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  errorHandler(err, {}, res, () => {});

  const printed = lines.join('\n');
  assert.ok(!printed.includes(KNOWN_TOKEN), 'token must never be printed by the error handler');
  assert.ok(!printed.includes(KNOWN_EMAIL), 'email must never be printed by the error handler');
  assert.match(printed, /\[Error Handler\]/);
  assert.match(printed, /Error:/);

  // 500 responses remain generic
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'Something went wrong' });
});

test('error handler preserves existing response contracts', (t) => {
  captureConsole(t, 'error'); // silence redacted operational logging
  const makeRes = () => ({
    statusCode: null,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  });

  // Mongoose validation errors -> 400 with details (unchanged shape)
  const validationError = new Error('Validation failed');
  validationError.name = 'ValidationError';
  validationError.errors = { title: { message: 'Title is required' } };
  const res1 = makeRes();
  errorHandler(validationError, {}, res1, () => {});
  assert.equal(res1.statusCode, 400);
  assert.deepEqual(res1.body, { error: 'Validation failed', details: { title: 'Title is required' } });

  // Explicit status errors -> message passthrough (redaction is a no-op on safe text)
  const notFound = new Error('Task not found');
  notFound.status = 404;
  const res2 = makeRes();
  errorHandler(notFound, {}, res2, () => {});
  assert.equal(res2.statusCode, 404);
  assert.deepEqual(res2.body, { error: 'Task not found' });
});
