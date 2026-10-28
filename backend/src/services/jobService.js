import Job, { JOB_STATUSES, canTransition } from '../models/jobModel.js';
import { getPayloadCipher } from '../security/payloadEncryption.js';
import { redactText } from '../security/redaction.js';
import {
  EMAIL_JOB_PURPOSE,
  EMAIL_JOB_TYPE,
  JOB_POLICY,
  computeBackoffMs,
} from '../config/jobConfig.js';

/**
 * Job store interface. Every state change is a single guarded atomic
 * findOneAndUpdate so two poll cycles (or future worker instances) can never
 * both win the same transition. Queries are bounded: one claimed document per
 * call, aggregate counts via countDocuments — the collection is never loaded
 * into memory.
 *
 * All dependencies are injectable for tests (JobModel, cipher, clock, random,
 * logger). The default singleton uses the real Mongoose model and the
 * env-backed AES-256-GCM cipher.
 */

export class JobServiceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JobServiceError';
  }
}

const MAX_ERROR_MESSAGE_LENGTH = 500;
const MAX_ERROR_CATEGORY_LENGTH = 64;

function sanitizeCategory(category) {
  const value = typeof category === 'string' && category.trim().length > 0 ? category.trim() : 'unknown';
  return redactText(value).replace(/\s+/g, '_').slice(0, MAX_ERROR_CATEGORY_LENGTH);
}

function sanitizeMessage(message) {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return null;
  }
  return redactText(message).slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function validateResetPayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new JobServiceError('Payload must be a plain object.');
  }
  for (const field of ['email', 'resetToken', 'frontendUrl']) {
    const value = payload[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new JobServiceError(`Invalid payload field: ${field} must be a non-empty string.`);
    }
  }
}

export function createJobService({
  JobModel = Job,
  cipher = null,
  policy = JOB_POLICY,
  random = Math.random,
  logger = console,
  now = () => Date.now(),
} = {}) {
  const getCipher = () => (cipher !== null && cipher !== undefined ? cipher : getPayloadCipher());

  // In-memory operational counter for enqueue failures (resets on restart;
  // exposed only through aggregate statistics).
  let enqueueFailures = 0;

  /** processing -> dead (guarded): terminal, sanitized error kept, retention set. */
  async function markDeadInternal(job, errorInfo = {}, at = now()) {
    if (!canTransition(job?.status, 'dead')) {
      return { status: 'lost' };
    }
    const updated = await JobModel.findOneAndUpdate(
      { _id: job._id, status: 'processing' },
      {
        $set: {
          status: 'dead',
          completedAt: new Date(at),
          expiresAt: new Date(at + policy.terminalRetentionMs),
          errorCategory: sanitizeCategory(errorInfo.category),
          errorMessage: sanitizeMessage(errorInfo.message),
        },
        $unset: { leaseUntil: 1 },
      },
      { new: true }
    );
    return updated ? { status: 'dead', job: updated } : { status: 'lost' };
  }

  return {
    /** Encrypts and persists an email.password_reset job. Throws JobServiceError on invalid input. */
    async enqueuePasswordReset(payload, { correlationId } = {}) {
      validateResetPayload(payload);

      const envelope = getCipher().encrypt(payload, EMAIL_JOB_PURPOSE);
      const job = await JobModel.create({
        type: EMAIL_JOB_TYPE,
        payload: envelope,
        nextAttemptAt: new Date(now()),
        correlationId: typeof correlationId === 'string' ? correlationId.slice(0, 64) : null,
      });
      return job;
    },

    /**
     * Atomically claims the oldest due pending job:
     * pending -> processing, attempts+1, lease set. Returns the claimed job
     * (payload included) or null when nothing is due. Concurrent callers
     * cannot both claim the same document.
     */
    async claimDueJob(at = now()) {
      const atDate = new Date(at);
      const job = await JobModel.findOneAndUpdate(
        { status: 'pending', nextAttemptAt: { $lte: atDate } },
        {
          $set: { status: 'processing', startedAt: atDate, leaseUntil: new Date(at + policy.leaseMs) },
          $inc: { attempts: 1 },
        },
        { sort: { nextAttemptAt: 1 }, new: true }
      ).select('+payload');
      return job;
    },

    /** processing -> succeeded (guarded). Clears the lease; sets terminal expiry. */
    async markSucceeded(job, at = now()) {
      if (!canTransition(job?.status, 'succeeded')) {
        return null;
      }
      const updated = await JobModel.findOneAndUpdate(
        { _id: job._id, status: 'processing' },
        {
          $set: {
            status: 'succeeded',
            completedAt: new Date(at),
            expiresAt: new Date(at + policy.terminalRetentionMs),
            errorCategory: null,
            errorMessage: null,
          },
          $unset: { leaseUntil: 1 },
        },
        { new: true }
      );
      return updated;
    },

    /**
     * processing -> pending with exponential backoff + jitter, or processing ->
     * dead when attempts are exhausted. Returns { status, job? } where status
     * is 'pending' | 'dead' | 'lost' (guard lost: job was reclaimed/reclaimed
     * elsewhere — a documented at-least-once safety outcome).
     */
    async scheduleRetry(job, errorInfo = {}, at = now()) {
      const category = sanitizeCategory(errorInfo.category);
      const message = sanitizeMessage(errorInfo.message);

      if (job.attempts >= job.maxAttempts) {
        return markDeadInternal(
          job,
          {
            category,
            message: `${message ?? 'Job failed'} (attempts exhausted: ${job.attempts}/${job.maxAttempts})`,
          },
          at
        );
      }

      const nextAttemptAt = new Date(at + computeBackoffMs(job.attempts, random));
      const updated = await JobModel.findOneAndUpdate(
        { _id: job._id, status: 'processing' },
        {
          $set: { status: 'pending', nextAttemptAt, errorCategory: category, errorMessage: message },
          $unset: { leaseUntil: 1, startedAt: 1 },
        },
        { new: true }
      );
      return updated ? { status: 'pending', job: updated } : { status: 'lost' };
    },

    /** processing -> dead (guarded): terminal, sanitized error kept, retention set. */
    async markDead(job, errorInfo = {}, at = now()) {
      return markDeadInternal(job, errorInfo, at);
    },

    /**
     * Requeues processing jobs whose lease expired (worker crash/shutdown
     * window). Only lease-expired documents are touched, so a legitimate
     * in-flight job (lease always exceeds worst-case SMTP time) is never stolen.
     * Returns the number of reclaimed jobs.
     */
    async recoverExpiredLeases(at = now()) {
      const result = await JobModel.updateMany(
        { status: 'processing', leaseUntil: { $lte: new Date(at) } },
        {
          $set: { status: 'pending', nextAttemptAt: new Date(at), errorMessage: null, errorCategory: null },
          $unset: { leaseUntil: 1, startedAt: 1 },
        }
      );
      return result?.modifiedCount ?? 0;
    },

    /** Records a failed enqueue (user saved, job not persisted). Sanitized: never logs payload/token/email. */
    noteEnqueueFailure(error, correlationId) {
      enqueueFailures += 1;
      const category = sanitizeCategory(error?.name || 'Error');
      const message = sanitizeMessage(typeof error?.message === 'string' ? error.message : String(error));
      logger.error(
        `[jobs] enqueue failure type=${EMAIL_JOB_TYPE} correlationId=${correlationId || 'none'} category=${category} message=${message ?? 'n/a'}`
      );
      return enqueueFailures;
    },

    getEnqueueFailures() {
      return enqueueFailures;
    },

    /** Aggregate operational statistics only — no payloads, tokens, emails, or raw errors. */
    async getStats(at = now()) {
      const counts = {};
      let total = 0;
      for (const status of JOB_STATUSES) {
        const count = await JobModel.countDocuments({ status });
        counts[status] = count;
        total += count;
      }
      counts.total = total;

      const oldestPending = await JobModel.findOne({ status: 'pending' })
        .sort({ nextAttemptAt: 1 })
        .select('nextAttemptAt createdAt');

      let oldestPendingAgeMs = null;
      if (oldestPending) {
        const base = oldestPending.nextAttemptAt ?? oldestPending.createdAt;
        if (base instanceof Date) {
          oldestPendingAgeMs = Math.max(0, at - base.getTime());
        }
      }

      return {
        counts,
        queued: counts.pending + counts.processing,
        processingCount: counts.processing,
        deadCount: counts.dead,
        oldestPendingAgeMs,
        enqueueFailures,
      };
    },
  };
}

/** Application singleton used by the controller, worker, and debug endpoint. */
export const jobService = createJobService();
