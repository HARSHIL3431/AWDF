import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import jwt from 'jsonwebtoken';

import {
  generateDescription,
  AiServiceError,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from '../src/services/aiDescriptionService.js';
import { createAiRateLimiter } from '../src/middleware/aiRateLimiter.js';
import { createAiController } from '../src/controllers/aiController.js';
import { createAiRoutes } from '../src/routes/aiRoutes.js';
import Task from '../src/models/taskModel.js';
import { taskController } from '../src/controllers/taskController.js';
import { cacheService } from '../src/services/cacheService.js';

// Practical 13 — AI description generator.
//
// Everything a provider would do is MOCKED: no API key is read from the
// environment, no network call is made and no test can spend money. CI there-
// fore runs this file with no secret configured at all. The key used below is
// a deliberately fake string so we can prove it never reaches a response.
//
// Conventions follow cache.test.js / controller.test.js: node:test +
// node:assert/strict, hand-built response objects, and patches that restore
// themselves when the test ends. No database is touched and the integration
// database safety guard is never involved.

const FAKE_KEY = 'sk-test-not-a-real-key-0123456789abcdef';
const TEST_SECRET = 'practical-13-ai-test-secret';

const FALLBACK_BODY = {
  description: '',
  fallback: true,
  message: 'AI suggestions are temporarily unavailable. You can enter the description manually.',
};
const SUCCESS_MESSAGE = 'AI suggestion generated. Review it before using.';

function makeRes() {
  return {
    statusCode: null,
    body: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
}

function thrower(err) {
  throw err;
}

const patchRegistry = new WeakMap();

/** Patches a method; all patches from one test restore in reverse order. */
function patch(t, target, name, impl) {
  let list = patchRegistry.get(t);
  if (list === undefined) {
    list = [];
    patchRegistry.set(t, list);
    t.after(() => {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        list[i].target[list[i].name] = list[i].original;
      }
    });
  }
  list.push({ target, name, original: target[name] });
  target[name] = impl;
}

/** Several paths log a redacted one-line failure on purpose; silence them. */
function quietLogs(t) {
  patch(t, console, 'error', () => {});
}

// --- mocked provider transport -------------------------------------------

function providerReply(status, text) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  });
}

function providerJson(status, body) {
  return providerReply(status, JSON.stringify(body));
}

function recordingFetch(impl) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return impl(url, opts);
  };
  fn.calls = calls;
  return fn;
}

const OPENAI_OK = {
  choices: [
    {
      message: {
        role: 'assistant',
        content: '  "Prepare a verified off-site database backup and confirm the restore point works."  ',
      },
    },
  ],
};

const GEMINI_OK = {
  candidates: [{ content: { parts: [{ text: 'Back up the database and test that the restore works.' }] } }],
};

// ==========================================================================
// Provider service
// ==========================================================================

test('ai: a successful call sends only the title, keeps the key in a header and returns cleaned text', async () => {
  const fetchImpl = recordingFetch(providerJson(200, OPENAI_OK));

  const result = await generateDescription({
    title: '  Prepare    database backup  ',
    env: { AI_PROVIDER: 'openai', OPENAI_API_KEY: FAKE_KEY },
    fetchImpl,
  });

  assert.equal(result.provider, 'openai');
  assert.equal(
    result.description,
    'Prepare a verified off-site database backup and confirm the restore point works.',
    'wrapping quotes and extra whitespace are cleaned'
  );

  assert.equal(fetchImpl.calls.length, 1);
  const { url, opts } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(opts.headers.Authorization, `Bearer ${FAKE_KEY}`, 'key travels in a header');
  assert.ok(!url.includes(FAKE_KEY), 'key never appears in the URL');

  const wire = opts.body;
  assert.ok(!wire.includes(FAKE_KEY), 'key never enters the request body');
  assert.equal(
    JSON.parse(wire).messages.at(-1).content,
    'Task title: Prepare database backup',
    'the title is normalized and is the only user data sent'
  );
  assert.ok(!/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(wire), 'no e-mail address is sent to the provider');
  assert.ok(!/password|jwt|bearer /i.test(wire), 'no credential of any kind is sent to the provider');
});

test('ai: the Gemini provider is selected by configuration and also keeps its key in a header', async () => {
  const fetchImpl = recordingFetch(providerJson(200, GEMINI_OK));

  const result = await generateDescription({
    title: 'Rotate the staging credentials',
    env: { AI_PROVIDER: 'gemini', GEMINI_API_KEY: FAKE_KEY },
    fetchImpl,
  });

  assert.equal(result.provider, 'gemini');
  const { url, opts } = fetchImpl.calls[0];
  assert.ok(url.includes('generativelanguage.googleapis.com'));
  assert.ok(url.endsWith(':generateContent'));
  assert.ok(!url.includes(FAKE_KEY), 'key never appears in the URL');
  assert.equal(opts.headers['x-goog-api-key'], FAKE_KEY);
  assert.ok(!opts.headers.Authorization, 'provider-specific header only');
  assert.equal(
    JSON.parse(opts.body).contents[0].parts[0].text,
    'Task title: Rotate the staging credentials'
  );
  assert.equal(result.description, 'Back up the database and test that the restore works.');
});

test('ai: a missing API key fails closed before any network request (the graceful-fallback path)', async () => {
  const fetchImpl = recordingFetch(providerJson(200, OPENAI_OK));
  const envs = [
    {},
    { AI_PROVIDER: 'openai' },
    { AI_PROVIDER: 'openai', OPENAI_API_KEY: '' },
    { AI_PROVIDER: 'openai', OPENAI_API_KEY: '   ' },
    { AI_PROVIDER: 'gemini' },
  ];

  for (const env of envs) {
    await assert.rejects(
      () => generateDescription({ title: 'Prepare database backup', env, fetchImpl }),
      (err) => {
        assert.ok(err instanceof AiServiceError, 'typed provider error');
        assert.equal(err.code, 'missingKey', JSON.stringify(env));
        assert.ok(!err.message.includes(FAKE_KEY));
        return true;
      }
    );
  }
  assert.equal(fetchImpl.calls.length, 0, 'no provider call is attempted without a key');
});

test('ai: an unsupported provider name is rejected before any request', async () => {
  const fetchImpl = recordingFetch(providerJson(200, OPENAI_OK));

  await assert.rejects(
    () =>
      generateDescription({
        title: 'Prepare database backup',
        env: { AI_PROVIDER: 'skynet', OPENAI_API_KEY: FAKE_KEY },
        fetchImpl,
      }),
    (err) => err instanceof AiServiceError && err.code === 'unsupportedProvider'
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test('ai: a provider timeout is bounded and reported as unavailable, never leaking the key', async () => {
  const hangUntilAbort = (_url, opts) =>
    new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'AbortError';
        reject(err);
      });
    });
  const fetchImpl = recordingFetch(hangUntilAbort);

  const startedAt = Date.now();
  await assert.rejects(
    () =>
      generateDescription({
        title: 'Prepare database backup',
        env: { OPENAI_API_KEY: FAKE_KEY },
        fetchImpl,
        timeoutMs: 40,
      }),
    (err) => {
      assert.ok(err instanceof AiServiceError);
      assert.equal(err.code, 'timeout');
      assert.ok(!err.message.includes(FAKE_KEY), 'no key material in the error text');
      return true;
    }
  );
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(Date.now() - startedAt < 5_000, 'the timeout is explicit and short');
});

test('ai: a network failure is reported as unavailable rather than crashing', async () => {
  const fetchImpl = recordingFetch(async () => {
    const err = new TypeError('fetch failed');
    err.cause = new Error('connect ECONNREFUSED 127.0.0.1:443');
    throw err;
  });

  await assert.rejects(
    () =>
      generateDescription({
        title: 'Prepare database backup',
        env: { OPENAI_API_KEY: FAKE_KEY },
        fetchImpl,
      }),
    (err) => err instanceof AiServiceError && err.code === 'network'
  );
});

test('ai: quota, rejected key, bad request and provider 5xx each produce a typed error with no provider text', async () => {
  const cases = [
    [429, 'quota'],
    [401, 'invalidKey'],
    [403, 'invalidKey'],
    [400, 'providerError'],
    [500, 'providerError'],
  ];

  for (const [status, expectedCode] of cases) {
    // The body deliberately embeds the key: the service must never carry it.
    const fetchImpl = recordingFetch(
      providerJson(status, { error: { message: `provider said ${FAKE_KEY} is wrong` } })
    );

    await assert.rejects(
      () =>
        generateDescription({
          title: 'Prepare database backup',
          env: { OPENAI_API_KEY: FAKE_KEY },
          fetchImpl,
        }),
      (err) => {
        assert.ok(err instanceof AiServiceError, `HTTP ${status}`);
        assert.equal(err.code, expectedCode, `HTTP ${status}`);
        assert.ok(!err.message.includes(FAKE_KEY), 'raw provider text is never carried into the error');
        return true;
      }
    );
  }
});

test('ai: malformed or empty provider output degrades instead of returning junk', async () => {
  const cases = [
    { label: 'non-JSON body', raw: 'this is not json', env: { OPENAI_API_KEY: FAKE_KEY } },
    { label: 'empty object', raw: '{}', env: { OPENAI_API_KEY: FAKE_KEY } },
    { label: 'no choices', raw: JSON.stringify({ choices: [] }), env: { OPENAI_API_KEY: FAKE_KEY } },
    {
      label: 'blank content',
      raw: JSON.stringify({ choices: [{ message: { content: '   ' } }] }),
      env: { OPENAI_API_KEY: FAKE_KEY },
    },
    {
      label: 'non-string content',
      raw: JSON.stringify({ choices: [{ message: { content: 42 } }] }),
      env: { OPENAI_API_KEY: FAKE_KEY },
    },
    {
      label: 'gemini without candidates',
      raw: JSON.stringify({ candidates: [] }),
      env: { AI_PROVIDER: 'gemini', GEMINI_API_KEY: FAKE_KEY },
    },
  ];

  for (const { label, raw, env } of cases) {
    const fetchImpl = recordingFetch(providerReply(200, raw));
    await assert.rejects(
      () => generateDescription({ title: 'Prepare database backup', env, fetchImpl }),
      (err) => {
        assert.ok(err instanceof AiServiceError, label);
        assert.equal(err.code, 'malformed', label);
        return true;
      }
    );
  }
});

test('ai: missing and oversized titles are rejected before a provider is ever contacted', async () => {
  const fetchImpl = recordingFetch(providerJson(200, OPENAI_OK));
  const titles = [undefined, null, 42, {}, '', '   ', 'x'.repeat(MAX_TITLE_LENGTH + 1)];

  for (const title of titles) {
    await assert.rejects(
      () => generateDescription({ title, env: { OPENAI_API_KEY: FAKE_KEY }, fetchImpl }),
      (err) => err instanceof AiServiceError && err.code === 'invalidTitle'
    );
  }
  assert.equal(fetchImpl.calls.length, 0);
});

test('ai: an over-long provider answer is capped so the form can never be flooded', async () => {
  const raw = JSON.stringify({ choices: [{ message: { content: 'word '.repeat(500) } }] });
  const fetchImpl = recordingFetch(providerReply(200, raw));

  const { description } = await generateDescription({
    title: 'Prepare database backup',
    env: { OPENAI_API_KEY: FAKE_KEY },
    fetchImpl,
  });

  assert.ok(
    description.length <= MAX_DESCRIPTION_LENGTH,
    `length ${description.length} must stay <= ${MAX_DESCRIPTION_LENGTH}`
  );
  assert.ok(description.length > 0);
});

// ==========================================================================
// Controller contract
// ==========================================================================

test('ai: missing or invalid titles return the application 400 contract', async (t) => {
  quietLogs(t);
  let providerCalls = 0;
  const controller = createAiController({
    generateDescription: async () => {
      providerCalls += 1;
      return { description: 'should never happen' };
    },
  });

  const bodies = [
    undefined,
    {},
    { title: 123 },
    { title: null },
    { title: {} },
    { title: '' },
    { title: '   ' },
    { title: 'x'.repeat(MAX_TITLE_LENGTH + 1) },
  ];

  for (const body of bodies) {
    const res = makeRes();
    await controller.generate({ body }, res, thrower);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(typeof res.body.error, 'string');
    assert.equal(res.body.fallback, undefined, 'validation errors are not fallback responses');
  }
  assert.equal(providerCalls, 0, 'an invalid request never reaches the provider');
});

test('ai: a mocked provider result is returned with the exact success contract', async () => {
  let receivedTitle = null;
  const controller = createAiController({
    generateDescription: async ({ title }) => {
      receivedTitle = title;
      return { description: 'Verify the backup, then store it off-site.' };
    },
  });

  const res = makeRes();
  await controller.generate({ body: { title: '  Prepare database backup  ' } }, res, thrower);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    description: 'Verify the backup, then store it off-site.',
    fallback: false,
    message: SUCCESS_MESSAGE,
  });
  assert.equal(receivedTitle, 'Prepare database backup', 'the title is trimmed before use');
});

test('ai: provider failure answers 503 with the uniform fallback and leaks no provider detail', async (t) => {
  quietLogs(t);
  const controller = createAiController({
    generateDescription: async () => {
      throw new AiServiceError('quota');
    },
  });

  const res = makeRes();
  await controller.generate({ body: { title: 'Prepare database backup' } }, res, thrower);

  assert.equal(res.statusCode, 503, 'an operational failure must not masquerade as success');
  assert.deepEqual(res.body, FALLBACK_BODY);
  const serialized = JSON.stringify(res.body);
  assert.ok(!serialized.includes(FAKE_KEY), 'the key is never echoed');
  assert.ok(!serialized.includes('quota'), 'provider terminology is not exposed to the user');
});

test('ai: an unexpected exception inside the provider layer degrades to the fallback without a stack trace', async (t) => {
  quietLogs(t);
  const controller = createAiController({
    generateDescription: async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'choices')");
    },
  });

  const res = makeRes();
  await controller.generate({ body: { title: 'Prepare database backup' } }, res, thrower);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, FALLBACK_BODY);
  assert.ok(!JSON.stringify(res.body).includes('choices'), 'no internal message reaches the client');
});

test('ai: an empty provider result is treated as unavailable, not as a successful empty suggestion', async (t) => {
  quietLogs(t);
  const controller = createAiController({ generateDescription: async () => ({ description: '   ' }) });

  const res = makeRes();
  await controller.generate({ body: { title: 'Prepare database backup' } }, res, thrower);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, FALLBACK_BODY);
});

// ==========================================================================
// Per-task rate limit
// ==========================================================================

const WINDOW_MS = 60_000;

function limiterRequest(title, userId = 'user-1') {
  return { body: { title }, user: { id: userId }, socket: { remoteAddress: '127.0.0.1' } };
}

function runLimiter(limiter, req) {
  const res = makeRes();
  let passed = false;
  limiter(req, res, () => {
    passed = true;
  });
  return { res, passed };
}

test('ai: at most one generation per task key per minute, answered with 429 and Retry-After', () => {
  const clock = { at: 1_700_000_000_000 };
  const limiter = createAiRateLimiter({ now: () => clock.at, userMax: 100 });

  const first = runLimiter(limiter, limiterRequest('Prepare database backup'));
  assert.equal(first.passed, true, 'the first request passes');
  assert.equal(first.res.statusCode, null);

  const second = runLimiter(limiter, limiterRequest('Prepare database backup'));
  assert.equal(second.passed, false, 'the duplicate is blocked');
  assert.equal(second.res.statusCode, 429);
  assert.equal(second.res.headers['Retry-After'], '60');
  assert.match(second.res.body.error, /already generated/);
  assert.equal(
    JSON.stringify(second.res.body).includes('Prepare database backup'),
    false,
    'the 429 body does not echo the task title'
  );
});

test('ai: the limit is scoped to the task key — other titles and other users stay usable', () => {
  const clock = { at: 1_700_000_000_000 };
  const limiter = createAiRateLimiter({ now: () => clock.at, userMax: 100 });

  assert.equal(runLimiter(limiter, limiterRequest('Prepare database backup')).passed, true);
  assert.equal(runLimiter(limiter, limiterRequest('Prepare database backup')).passed, false);

  // Different title, same user: allowed (the key includes the title).
  assert.equal(runLimiter(limiter, limiterRequest('Draft the release notes')).passed, true);
  // Same title, different user: allowed (the key is scoped to the principal).
  assert.equal(runLimiter(limiter, limiterRequest('Prepare database backup', 'user-2')).passed, true);
});

test('ai: the window reopens when it expires (injectable clock — the suite never waits a minute)', () => {
  const clock = { at: 1_700_000_000_000 };
  const limiter = createAiRateLimiter({ now: () => clock.at, userMax: 100 });

  assert.equal(runLimiter(limiter, limiterRequest('Prepare database backup')).passed, true);
  assert.equal(runLimiter(limiter, limiterRequest('Prepare database backup')).passed, false);

  clock.at += WINDOW_MS;
  assert.equal(
    runLimiter(limiter, limiterRequest('Prepare database backup')).passed,
    true,
    'the same key is allowed again after one window'
  );
});

test('ai: an invalid title never consumes quota — the controller owns the 400', () => {
  const clock = { at: 1_700_000_000_000 };
  const limiter = createAiRateLimiter({ now: () => clock.at, userMax: 100 });

  assert.equal(runLimiter(limiter, limiterRequest(undefined)).passed, true);
  assert.equal(runLimiter(limiter, limiterRequest('')).passed, true);
  assert.equal(runLimiter(limiter, limiterRequest('    ')).passed, true);

  // The first VALID request is therefore still the first counted one.
  assert.equal(runLimiter(limiter, limiterRequest('Prepare database backup')).passed, true);
  assert.equal(runLimiter(limiter, limiterRequest('Prepare database backup')).passed, false);
});

test('ai: a per-account ceiling bounds callers minting unlimited fresh keys', () => {
  const clock = { at: 1_700_000_000_000 };
  const limiter = createAiRateLimiter({ now: () => clock.at, taskMax: 1, userMax: 3 });

  const titles = ['Alpha task', 'Bravo task', 'Charlie task', 'Delta task'];
  const results = titles.map((title) => runLimiter(limiter, limiterRequest(title)));

  assert.deepEqual(
    results.map((r) => r.passed),
    [true, true, true, false],
    'the fourth distinct key in the window is refused'
  );
  assert.equal(results[3].res.statusCode, 429);
  assert.equal(results[3].res.headers['Retry-After'], '60');
  assert.match(results[3].res.body.error, /Too many AI requests/);
});

test('ai: bucket storage stays bounded under key churn', () => {
  const clock = { at: 1_700_000_000_000 };
  const limiter = createAiRateLimiter({ now: () => clock.at, taskMax: 10_000, userMax: 10_000, maxSize: 8 });

  for (let i = 0; i < 500; i += 1) {
    runLimiter(limiter, limiterRequest(`unique title ${i}`, `user-${i % 50}`));
  }

  const stats = limiter.stats();
  assert.equal(stats.maxSize, 8);
  assert.ok(stats.size <= stats.maxSize, `size ${stats.size} must stay <= ${stats.maxSize}`);
});

// ==========================================================================
// Route wiring, authentication and end-to-end behaviour over real HTTP
// ==========================================================================

async function startApp(t, options = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', createAiRoutes(options));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('ai: /api/ai/generate-description resolves and requires a token exactly like the task routes', async (t) => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_SECRET;
  t.after(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  let providerCalls = 0;
  const base = await startApp(t, {
    generateDescription: async () => {
      providerCalls += 1;
      return { description: 'unused' };
    },
    limiter: createAiRateLimiter({ userMax: 100 }),
  });
  const url = `${base}/api/ai/generate-description`;
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Prepare database backup' }),
  };

  const noToken = await fetch(url, init);
  assert.equal(noToken.status, 401, 'the documented path resolves (401, not 404) and auth runs first');
  assert.deepEqual(await noToken.json(), { error: 'Access token required' });

  const malformed = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: 'Bearer not.a.jwt' },
  });
  assert.equal(malformed.status, 401);
  assert.deepEqual(await malformed.json(), { error: 'Invalid or expired token' });
  assert.equal(providerCalls, 0, 'the provider is never reached without a valid token');

  // With a valid token the endpoint is reachable — and nothing else under
  // /api/ai is, which is how we prove the exact required path.
  const token = jwt.sign({ id: 'user-42' }, TEST_SECRET, { expiresIn: '5m' });
  const authed = { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } };

  const invalidInput = await fetch(url, { ...authed, body: JSON.stringify({ title: '' }) });
  assert.equal(invalidInput.status, 400, 'the documented path reaches the controller');

  const wrongPath = await fetch(`${base}/api/ai/unknown`, authed);
  assert.equal(wrongPath.status, 404, 'only the documented path exists');

  assert.equal(providerCalls, 0, 'no provider call was made by any of the rejected requests');
});

test('ai: end-to-end — authenticated 200 contract, then the per-task 429, then the window reopens', async (t) => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_SECRET;
  t.after(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  const clock = { at: 1_700_000_000_000 };
  const base = await startApp(t, {
    generateDescription: async () => ({ description: 'Verify the backup and confirm the restore point.' }),
    limiter: createAiRateLimiter({ now: () => clock.at, userMax: 100 }),
  });

  const token = jwt.sign({ id: 'user-42' }, TEST_SECRET, { expiresIn: '5m' });
  const url = `${base}/api/ai/generate-description`;
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: 'Prepare database backup' }),
  };

  const first = await fetch(url, init);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    description: 'Verify the backup and confirm the restore point.',
    fallback: false,
    message: SUCCESS_MESSAGE,
  });

  const second = await fetch(url, init);
  assert.equal(second.status, 429, 'the second identical request in the window is throttled');
  assert.match(second.headers.get('Retry-After') ?? '', /^\d+$/);
  const throttled = await second.json();
  assert.equal(typeof throttled.error, 'string');
  assert.ok(!JSON.stringify(throttled).includes('Prepare database backup'));

  clock.at += WINDOW_MS;
  const third = await fetch(url, init);
  assert.equal(third.status, 200, 'the same task key is usable again after the window');
  await third.json();
});

// ==========================================================================
// Existing behaviour stays intact while AI is unavailable
// ==========================================================================

test('ai: task creation and existing endpoints keep working while the AI provider is unavailable', async (t) => {
  quietLogs(t);
  cacheService.flush();

  // AI path: no key in the environment and no reachable provider.
  const controller = createAiController({
    generateDescription: ({ title }) =>
      generateDescription({
        title,
        env: {},
        fetchImpl: async () => {
          throw new Error('network must not be used without a key');
        },
      }),
  });
  const aiRes = makeRes();
  await controller.generate({ body: { title: 'Prepare database backup' } }, aiRes, thrower);
  assert.equal(aiRes.statusCode, 503);
  assert.deepEqual(aiRes.body, FALLBACK_BODY);

  // Unrelated, existing behaviour is untouched.
  patch(t, Task, 'create', async (doc) => ({ id: 'c'.repeat(24), ...doc }));
  const createRes = makeRes();
  await taskController.createTask(
    { body: { title: 'Prepare database backup', description: '', completed: false, priority: 'medium' } },
    createRes,
    thrower
  );
  assert.equal(createRes.statusCode, 201, 'normal task creation still succeeds with AI down');

  patch(t, Task, 'find', async () => [{ id: 'a'.repeat(24), title: 'existing task' }]);
  const listRes = makeRes();
  await taskController.getAllTasks({}, listRes, thrower);
  assert.equal(listRes.statusCode, 200, 'reading tasks is unaffected by an AI outage');
  assert.equal(listRes.body.length, 1);
});

// ==========================================================================
// Frontend privacy guard (the UI layer has no test runner in this project,
// so the two hard security rules it must obey are enforced statically here
// instead of being asserted with screenshots or left unverified).
// ==========================================================================

test('ai: the frontend never calls a provider directly and never carries a provider key variable', () => {
  const frontendSrc = fileURLToPath(new URL('../../frontend/src', import.meta.url));
  assert.ok(existsSync(frontendSrc), 'frontend source must be present for this security guard');

  const offenders = [];
  const stack = [frontendSrc];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!/\.(js|jsx|mjs|ts|tsx)$/.test(entry.name)) continue;
      const text = readFileSync(full, 'utf8');
      if (/https?:\/\/(api\.openai\.com|generativelanguage\.googleapis\.com)/i.test(text)) {
        offenders.push(`${full}: direct provider endpoint`);
      }
      if (/VITE_[A-Z0-9_]*(OPENAI|GEMINI|ANTHROPIC)/i.test(text)) {
        offenders.push(`${full}: provider key exposed as a VITE_ variable`);
      }
      if (/\bOPENAI_API_KEY\b|\bGEMINI_API_KEY\b/.test(text)) {
        offenders.push(`${full}: backend key name referenced in browser code`);
      }
    }
  }

  assert.deepEqual(offenders, [], `frontend must only talk to the backend:\n${offenders.join('\n')}`);
});
