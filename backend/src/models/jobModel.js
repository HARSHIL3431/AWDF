import mongoose from 'mongoose';
import { EMAIL_JOB_TYPE, JOB_POLICY } from '../config/jobConfig.js';

/**
 * Durable background-job document.
 *
 * Lifecycle (all transitions enforced by guarded atomic updates in jobService):
 *   pending -> processing -> succeeded
 *   processing -> pending   (retryable failure, future nextAttemptAt)
 *   processing -> dead      (exhausted attempts or non-retryable failure)
 *   processing -> pending   (expired lease recovery after a crash)
 *
 * payload: AES-256-GCM envelope { v, iv, tag, ct }; select:false so ordinary
 * queries and API serialization can never return it by accident.
 *
 * expiresAt is set ONLY on terminal states (succeeded/dead), so the TTL index
 * can never delete an active pending/processing job. Retention: 7 days.
 */

export const JOB_STATUSES = Object.freeze(['pending', 'processing', 'succeeded', 'dead']);
export const JOB_TYPES = Object.freeze([EMAIL_JOB_TYPE]);

const ALLOWED_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['processing']),
  processing: Object.freeze(['succeeded', 'pending', 'dead']),
  succeeded: Object.freeze([]),
  dead: Object.freeze([]),
});

/** Returns true when from -> to is a legal lifecycle transition. */
export function canTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

const jobSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: [true, 'Job type is required'],
      enum: {
        values: [...JOB_TYPES],
        message: 'Unsupported job type',
      },
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: [...JOB_STATUSES],
        message: 'Invalid job status',
      },
      default: 'pending',
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: [true, 'Encrypted payload is required'],
      select: false, // never returned by default queries or JSON serialization
    },
    attempts: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'attempts cannot be negative'],
    },
    maxAttempts: {
      type: Number,
      required: true,
      default: JOB_POLICY.maxAttempts,
      min: [1, 'maxAttempts must be at least 1'],
    },
    nextAttemptAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    leaseUntil: {
      type: Date,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    correlationId: {
      type: String,
      maxlength: 64,
      default: null,
    },
    errorCategory: {
      type: String,
      maxlength: 64,
      default: null,
    },
    errorMessage: {
      type: String,
      maxlength: 500,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null, // set only when the job becomes terminal
    },
  },
  {
    timestamps: true, // createdAt / updatedAt
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        delete ret.payload; // defense in depth: encrypted payload never serialized
        return ret;
      },
    },
  }
);

// Claim query: pending jobs eligible to run now.
jobSchema.index({ status: 1, nextAttemptAt: 1 });
// Lease recovery: processing jobs whose lease expired.
jobSchema.index({ status: 1, leaseUntil: 1 });
// Terminal-job cleanup (deliberate 7-day retention, see expiresAt above).
jobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Job = mongoose.model('Job', jobSchema);

export default Job;
