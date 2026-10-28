import { jobService } from '../services/jobService.js';

/**
 * GET /debug/jobs — authenticated aggregate job statistics
 * (mirrors the existing /debug/cache-stats convention: authenticateToken
 * mounted in server.js; this application has no role/admin model, so plain
 * authentication is the established pattern).
 *
 * Returns counts/status aggregates only. Never returns: payloads, decrypted
 * tokens, recipient emails, correlation IDs, encryption material, or raw
 * exception text (verified by test/controller.test.js).
 */
export function createJobStatsHandler({ statsProvider = jobService } = {}) {
  return async function jobStats(req, res, next) {
    try {
      const stats = await statsProvider.getStats();
      res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  };
}

export const jobStatsHandler = createJobStatsHandler();
