import { sendPasswordResetEmail } from '../services/emailService.js';
import { getPayloadCipher } from '../security/payloadEncryption.js';
import { redactText } from '../security/redaction.js';
import {
  EMAIL_JOB_PURPOSE,
  EMAIL_JOB_TYPE,
  JOB_POLICY,
  SMTP_TIMEOUTS,
} from '../config/jobConfig.js';

/**
 * In-process email job worker.
 *
 * - Sequential single loop: poll cycles never overlap; concurrency is 1.
 * - Claims are atomic (jobService), so two cycles/instances cannot both send.
 * - Delivery guarantee: AT-LEAST-ONCE. A crash after SMTP acceptance but
 *   before markSucceeded leaves the job processing; the lease later expires
 *   and the job is retried, which may send a duplicate email with the same
 *   (still valid) reset link. Exactly-once SMTP is not claimed.
 * - A single job failure never terminates the loop (per-job try/catch).
 * - start()/stop() only; no timers or loops at module import.
 * - stop() halts new claims immediately and waits up to `shutdownMs` for the
 *   in-flight job; anything unfinished stays `processing` and is recovered by
 *   lease expiry on the next start.
 */

const SMTP_WORST_CASE_MS =
  SMTP_TIMEOUTS.connectionTimeout + SMTP_TIMEOUTS.greetingTimeout + SMTP_TIMEOUTS.socketTimeout;

function validatePolicy(policy) {
  if (policy.leaseMs <= SMTP_WORST_CASE_MS) {
    throw new Error(
      `Job policy invalid: leaseMs (${policy.leaseMs}ms) must exceed worst-case SMTP time ` +
        `(${SMTP_WORST_CASE_MS}ms) or an active send could be reclaimed mid-flight.`
    );
  }
}

export function createEmailWorker({
  jobService,
  sendEmail = sendPasswordResetEmail,
  cipher = null,
  policy = JOB_POLICY,
  logger = console,
} = {}) {
  if (!jobService) {
    throw new Error('createEmailWorker requires a jobService.');
  }
  validatePolicy(policy);

  const getCipher = () => (cipher !== null && cipher !== undefined ? cipher : getPayloadCipher());

  let running = false;
  let stopping = false;
  let loopGeneration = 0;
  let loopPromise = null;
  let wakeSleep = null;
  let currentJob = null;

  function sleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        wakeSleep = null;
        resolve();
      }, ms);
      wakeSleep = () => {
        clearTimeout(timer);
        wakeSleep = null;
        resolve();
      };
    });
  }

  async function processJob(job) {
    const startedAt = Date.now();
    let outcome = 'failed';
    currentJob = job;

    try {
      if (job.type !== EMAIL_JOB_TYPE) {
        const res = await jobService.markDead(
          job,
          { category: 'unsupported_type', message: 'Job type is not supported by this worker.' },
          Date.now()
        );
        outcome = res?.status === 'dead' ? 'dead_unsupported_type' : 'lost';
        return;
      }

      let payload;
      try {
        payload = getCipher().decrypt(job.payload, EMAIL_JOB_PURPOSE);
      } catch {
        // Non-retryable: decrypting again will fail the same way.
        const res = await jobService.markDead(
          job,
          { category: 'decryption_failed', message: 'Job payload could not be decrypted or authenticated.' },
          Date.now()
        );
        outcome = res?.status === 'dead' ? 'dead_undecryptable' : 'lost';
        return;
      }

      const valid =
        payload !== null &&
        typeof payload === 'object' &&
        typeof payload.email === 'string' &&
        payload.email.trim().length > 0 &&
        typeof payload.resetToken === 'string' &&
        payload.resetToken.length > 0 &&
        typeof payload.frontendUrl === 'string' &&
        payload.frontendUrl.trim().length > 0;

      if (!valid) {
        const res = await jobService.markDead(
          job,
          { category: 'invalid_payload', message: 'Decrypted payload failed validation.' },
          Date.now()
        );
        outcome = res?.status === 'dead' ? 'dead_invalid_payload' : 'lost';
        return;
      }

      const result = await sendEmail(payload.email, payload.resetToken, payload.frontendUrl);

      if (result && result.success === true) {
        const updated = await jobService.markSucceeded(job, Date.now());
        outcome = updated ? 'succeeded' : 'lost';
      } else {
        // emailService returns { success: false, error } — it does not throw.
        const message = (result && result.error) || 'Email delivery failed';
        const res = await jobService.scheduleRetry(
          job,
          { category: 'smtp_error', message },
          Date.now()
        );
        outcome = res?.status === 'pending' ? 'retry_scheduled' : res?.status === 'dead' ? 'dead_exhausted' : 'lost';
      }
    } catch (err) {
      // Unexpected exception (send threw, store unavailable). Record a retry
      // so one bad job cannot kill the worker loop.
      try {
        const res = await jobService.scheduleRetry(
          job,
          { category: 'send_exception', message: String(err?.message ?? err) },
          Date.now()
        );
        outcome = res?.status === 'pending' ? 'retry_scheduled' : res?.status === 'dead' ? 'dead_exhausted' : 'lost';
      } catch (recordErr) {
        outcome = 'error_unrecorded';
        logger.error(
          `[worker] could not record failure job=${String(job?._id)} error=${redactText(String(recordErr?.message ?? recordErr))}`
        );
      }
    } finally {
      currentJob = null;
      logger.log(
        `[worker] job=${String(job?._id)} type=${job?.type} attempt=${job?.attempts}/${job?.maxAttempts} ` +
          `outcome=${outcome} durationMs=${Date.now() - startedAt} correlationId=${job?.correlationId ?? 'none'}`
      );
    }
  }

  /** One poll cycle: reclaim expired leases, then claim+process up to batchSize jobs. */
  async function runOnce() {
    const recovered = await jobService.recoverExpiredLeases(Date.now());
    if (recovered > 0) {
      logger.log(`[worker] reclaimed ${recovered} expired lease(s)`);
    }

    for (let i = 0; i < policy.batchSize; i += 1) {
      if (stopping) {
        break;
      }
      const job = await jobService.claimDueJob(Date.now());
      if (job === null || job === undefined) {
        break;
      }
      await processJob(job);
    }
  }

  async function loop(gen) {
    while (!stopping && gen === loopGeneration) {
      try {
        await runOnce();
      } catch (err) {
        // A poll-cycle error (e.g., DB hiccup) must never terminate the worker.
        logger.error(`[worker] poll cycle failed: ${redactText(String(err?.message ?? err))}`);
      }
      if (stopping || gen !== loopGeneration) {
        break;
      }
      await sleep(policy.pollIntervalMs);
    }
  }

  return {
    /** Starts the single background loop. Idempotent: a second call is a no-op. */
    start() {
      if (running) {
        return false;
      }
      running = true;
      stopping = false;
      loopGeneration += 1;
      const gen = loopGeneration;
      loopPromise = loop(gen).catch((err) => {
        logger.error(`[worker] loop stopped unexpectedly: ${redactText(String(err?.message ?? err))}`);
      });
      return true;
    },

    /**
     * Stops claiming new work, wakes the idle sleep, and waits up to
     * `timeoutMs` for the in-flight job (bounded by SMTP timeouts) to finish.
     * resolved.drained=false means the in-flight job was left `processing`
     * for lease-based recovery after restart.
     */
    async stop(timeoutMs = policy.shutdownMs) {
      if (!running) {
        return { stopped: true, drained: true, reason: 'not_running' };
      }
      stopping = true;
      if (wakeSleep !== null) {
        wakeSleep();
      }

      const startedAt = Date.now();
      let drained = false;
      let forceTimer = null;
      try {
        await Promise.race([
          loopPromise.then(() => {
            drained = true;
          }),
          new Promise((resolve) => {
            forceTimer = setTimeout(resolve, timeoutMs);
          }),
        ]);
      } finally {
        if (forceTimer !== null) {
          clearTimeout(forceTimer);
        }
        running = false;
        loopPromise = null;
      }
      return { stopped: true, drained, waitedMs: Date.now() - startedAt };
    },

    /** Test/observability helper: true while the loop is active. */
    isRunning() {
      return running;
    },

    /** Test helper: exposes a single cycle without timers. */
    runOnce,

    /** Test helper: true while a job is being processed. */
    isProcessing() {
      return currentJob !== null;
    },
  };
}
