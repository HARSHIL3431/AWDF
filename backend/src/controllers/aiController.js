import {
  generateDescription as defaultGenerateDescription,
  MAX_TITLE_LENGTH,
} from '../services/aiDescriptionService.js';

/**
 * Practical 13 — POST /api/ai/generate-description controller.
 *
 * Response contract (stable for the frontend):
 *
 *   200 { description, fallback: false, message }   AI produced text
 *   503 { description: '', fallback: true, message } AI unavailable (graceful)
 *   400 { error }                                   client input problem
 *   401 (authentication middleware)                 no/invalid token
 *   429 { error } + Retry-After (rate limiter)      per-task limit reached
 *
 * Provider failures answer 503 rather than 200 so operational problems stay
 * visible in logs, metrics and monitoring, while the body keeps the uniform
 * `fallback` shape the UI needs to render a friendly message. Nothing from the
 * provider — text, status detail, headers or stack — is ever echoed back.
 */

export const AI_FALLBACK_MESSAGE =
  'AI suggestions are temporarily unavailable. You can enter the description manually.';
export const AI_SUCCESS_MESSAGE = 'AI suggestion generated. Review it before using.';

export function createAiController({ generateDescription = defaultGenerateDescription } = {}) {
  return {
    // POST /api/ai/generate-description
    generate: async (req, res, next) => {
      try {
        const { title } = req.body || {};

        if (typeof title !== 'string' || !title.trim()) {
          return res.status(400).json({ error: 'Title is required' });
        }
        const cleanTitle = title.trim();
        if (cleanTitle.length > MAX_TITLE_LENGTH) {
          return res.status(400).json({
            error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer`,
          });
        }

        let result;
        try {
          result = await generateDescription({ title: cleanTitle });
        } catch (error) {
          // Expected failures are typed; anything else escaping the service is
          // still treated as "provider unavailable" so one broken integration
          // can never surface a stack trace or break task creation. Only the
          // error name/code is logged — never its message, which could hold
          // provider detail.
          console.error(
            '[ai] description generation failed:',
            error?.name ?? 'Error',
            error?.code ? `(${error.code})` : ''
          );
          return res.status(503).json({
            description: '',
            fallback: true,
            message: AI_FALLBACK_MESSAGE,
          });
        }

        const description =
          typeof result?.description === 'string' ? result.description.trim() : '';
        if (!description) {
          // A service that "succeeded" with empty text is still a failure.
          return res.status(503).json({
            description: '',
            fallback: true,
            message: AI_FALLBACK_MESSAGE,
          });
        }

        return res.status(200).json({
          description,
          fallback: false,
          message: AI_SUCCESS_MESSAGE,
        });
      } catch (error) {
        // Unrelated/unexpected failure (e.g. malformed body access): delegate
        // to the application's centralised error handler like every controller.
        return next(error);
      }
    },
  };
}

export const aiController = createAiController();
