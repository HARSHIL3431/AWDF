import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { aiRateLimiter } from '../middleware/aiRateLimiter.js';
import { createAiController } from '../controllers/aiController.js';

/**
 * Practical 13 — /api/ai routes.
 *
 * The application has no global /api prefix (auth lives at `/`, tasks at
 * `/tasks`), so server.js mounts this router at `/api/ai`, which makes
 * `POST /generate-description` resolve to exactly
 * `/api/ai/generate-description` without touching any existing route.
 *
 * Authentication policy mirrors src/routes/taskRoutes.js: this helper exists
 * to pre-fill the task form, so it requires the same token task creation does.
 * Weakening it would hand anonymous callers a way to spend API quota — so the
 * route is protected and the 401 behaviour is covered by tests.
 *
 * The factory exists so tests can inject a stub provider and a controllable
 * clock; production uses the default instance below.
 */
export function createAiRoutes({ generateDescription, limiter = aiRateLimiter } = {}) {
  const controller = createAiController({ generateDescription });
  const router = Router();

  // 1. Authentication first: an unauthenticated request never reaches the
  //    limiter, so it cannot consume anyone's quota.
  router.use(authenticateToken);

  // 2. Per-task, process-local quota (see middleware/aiRateLimiter.js).
  router.use(limiter);

  // 3. The endpoint itself.
  router.post('/generate-description', controller.generate);

  return router;
}

export default createAiRoutes();
