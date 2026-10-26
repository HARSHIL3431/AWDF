/**
 * Practical 13 — AI task description generator (provider integration).
 *
 * Security and privacy rules enforced here (see docs/practical-13-ai-integration.md):
 *
 *  - The provider key is read ONLY from a backend environment variable
 *    (OPENAI_API_KEY / GEMINI_API_KEY). It is never a VITE_* variable, never
 *    returned to a client, never placed in a URL query string, and never
 *    written to a log.
 *  - The ONLY application data sent to a provider is the task title the user
 *    just typed. No user records, e-mail addresses, tokens, task lists or
 *    unrelated configuration leave the process.
 *  - Every failure path (missing key, rejected key, quota, timeout, network,
 *    malformed output, unexpected shape) throws a typed AiServiceError whose
 *    message is a FIXED, client-safe string. Raw provider text, headers and
 *    stacks are never carried into the error, so they cannot reach a response.
 *  - Every call has an explicit timeout via AbortController.
 *  - No SDK: Node 24 ships a global fetch, so this module adds no dependency.
 *
 * `env`, `fetchImpl` and `timeoutMs` are injectable so the test suite can
 * exercise every path — success and failure — without a real key, without
 * network access and without paying a provider.
 */

export const AI_TIMEOUT_MS = 8_000;
export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 600;

/** Fixed, user-facing messages. Provider wording is never used verbatim. */
const MESSAGE = {
  invalidTitle: 'Task title is missing or too long.',
  unsupportedProvider: 'The configured AI provider is not supported.',
  missingKey: 'AI suggestions are not configured.',
  invalidKey: 'AI provider rejected the configured credentials.',
  quota: 'AI provider rate limit or quota exceeded.',
  providerError: 'AI provider returned an error.',
  timeout: 'AI provider did not respond in time.',
  network: 'AI provider is unreachable.',
  malformed: 'AI provider returned an unusable response.',
};

/**
 * A provider-layer failure with a message that is always safe to log and to
 * translate. `code` is a stable machine-readable identifier; it is the only
 * thing the controller uses to decide that the feature is unavailable.
 */
export class AiServiceError extends Error {
  constructor(code) {
    super(MESSAGE[code] ?? MESSAGE.providerError);
    this.name = 'AiServiceError';
    this.code = code;
  }
}

/**
 * The whole prompt. It describes the OUTPUT CONTRACT, not the application, and
 * never contains user or application data beyond the single title line below.
 */
const SYSTEM_PROMPT = [
  'You write a short task description for a task-management application.',
  'Reply with 2-3 sentences, at most 60 words, of plain actionable text saying what must be done and why it matters.',
  'Use only the task title you are given: do not invent people, dates, budgets, tools or requirements the title does not imply.',
  'Reply with the description only — no preamble, no greeting, no quotation marks, no markdown, no bullet points.',
].join(' ');

/**
 * Providers are described declaratively so both stay symmetric: build the
 * request (key travels in a HEADER, never the URL) and parse the response.
 */
const PROVIDERS = {
  openai: {
    keyEnv: 'OPENAI_API_KEY',
    modelEnv: 'OPENAI_MODEL',
    defaultModel: 'gpt-4o-mini',
    buildRequest({ key, model, title }) {
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          // Key in the Authorization header: never logged, never in a URL.
          Authorization: `Bearer ${key}`,
        },
        body: {
          model,
          temperature: 0.2,
          max_tokens: 160,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Task title: ${title}` },
          ],
        },
      };
    },
    parse(data) {
      const content = data?.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content : null;
    },
  },
  gemini: {
    keyEnv: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    defaultModel: 'gemini-2.0-flash',
    buildRequest({ key, model, title }) {
      return {
        url:
          'https://generativelanguage.googleapis.com/v1beta/models/' +
          `${encodeURIComponent(model)}:generateContent`,
        headers: {
          'Content-Type': 'application/json',
          // Official header form of the key — again never in the URL.
          'x-goog-api-key': key,
        },
        body: {
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: `Task title: ${title}` }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 160 },
        },
      };
    },
    parse(data) {
      const parts = data?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) return null;
      const text = parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
      return text || null;
    },
  },
};

export const AI_PROVIDERS = Object.keys(PROVIDERS);

function normalizeTitle(title) {
  if (typeof title !== 'string') return '';
  return title.trim().replace(/\s+/g, ' ');
}

/**
 * Collapse whitespace, strip wrapping quotes the model sometimes adds and cap
 * the length, so a provider can never flood the description field.
 */
function sanitizeDescription(raw) {
  if (typeof raw !== 'string') return '';
  const collapsed = raw.replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (!collapsed) return '';
  if (collapsed.length <= MAX_DESCRIPTION_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
}

function toAiError(error) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return new AiServiceError('timeout');
  }
  return new AiServiceError('network');
}

/**
 * Call the selected provider and return { description, provider, model }.
 *
 * Throws AiServiceError for every expected failure. Anything else escaping is
 * still caught by the controller, which answers with the same fallback shape.
 */
export async function generateDescription({
  title,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = AI_TIMEOUT_MS,
  provider: providerOverride,
} = {}) {
  const cleanTitle = normalizeTitle(title);
  if (!cleanTitle || cleanTitle.length > MAX_TITLE_LENGTH) {
    throw new AiServiceError('invalidTitle');
  }

  const providerName = String(providerOverride ?? env?.AI_PROVIDER ?? 'openai').trim().toLowerCase();
  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new AiServiceError('unsupportedProvider');
  }

  const key = env?.[provider.keyEnv];
  if (typeof key !== 'string' || key.trim() === '') {
    // Missing key: the feature degrades instead of the endpoint failing open.
    throw new AiServiceError('missingKey');
  }

  if (typeof fetchImpl !== 'function') {
    throw new AiServiceError('network');
  }

  const model = String(env[provider.modelEnv] || provider.defaultModel);
  const request = provider.buildRequest({ key: key.trim(), model, title: cleanTitle });

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);

  try {
    let response;
    try {
      response = await fetchImpl(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: timeout.signal,
      });
    } catch (error) {
      throw toAiError(error);
    }

    if (!response || typeof response.ok !== 'boolean') {
      throw new AiServiceError('network');
    }

    // Read (and discard) the body so the socket is released. It is never
    // logged and never returned to a client — only its status code is used.
    let raw;
    try {
      raw = await response.text();
    } catch (error) {
      throw toAiError(error);
    }

    if (!response.ok) {
      const status = response.status;
      if (status === 401 || status === 403) throw new AiServiceError('invalidKey');
      if (status === 429) throw new AiServiceError('quota');
      if (status >= 400) throw new AiServiceError('providerError');
      throw new AiServiceError('network');
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new AiServiceError('malformed');
    }

    const description = sanitizeDescription(provider.parse(payload));
    if (!description) {
      throw new AiServiceError('malformed');
    }

    return { description, provider: providerName, model };
  } finally {
    clearTimeout(timer);
  }
}
