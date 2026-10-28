import crypto from 'node:crypto';
import { JOB_POLICY } from '../../src/config/jobConfig.js';

/**
 * In-memory stand-in for the Mongoose Job model.
 *
 * Implements exactly the query shapes jobService uses, with the same
 * single-document atomicity semantics MongoDB guarantees for
 * findOneAndUpdate: the mutation is applied synchronously at call time, so
 * two concurrent claim attempts can never both win.
 *
 * This is a UNIT-test fake. It does not prove Atlas-side behavior; real
 * database integration remains explicitly untested (see final report).
 */

function cmp(a, b) {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av === bv) return 0;
  return av < bv ? -1 : 1;
}

function matchesCondition(value, condition) {
  if (
    condition !== null &&
    typeof condition === 'object' &&
    !(condition instanceof Date) &&
    typeof condition.$lte !== 'undefined'
  ) {
    if (value === null || value === undefined) return false;
    return cmp(value, condition.$lte) <= 0;
  }
  if (condition instanceof Date && value instanceof Date) {
    return value.getTime() === condition.getTime();
  }
  return value === condition;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([field, condition]) => matchesCondition(doc[field], condition));
}

function applyUpdate(doc, update) {
  if (update.$set) {
    for (const [field, value] of Object.entries(update.$set)) {
      doc[field] = value;
    }
  }
  if (update.$inc) {
    for (const [field, value] of Object.entries(update.$inc)) {
      doc[field] = (doc[field] ?? 0) + value;
    }
  }
  if (update.$unset) {
    for (const field of Object.keys(update.$unset)) {
      delete doc[field];
    }
  }
  doc.updatedAt = new Date();
}

class FakeQuery {
  constructor(docs) {
    this._docs = docs;
    this._sort = null;
  }

  sort(spec) {
    this._sort = spec;
    return this;
  }

  select() {
    return this;
  }

  _exec() {
    let docs = this._docs;
    if (this._sort !== null && docs.length > 1) {
      const [field, direction] = Object.entries(this._sort)[0];
      docs = [...docs].sort((a, b) => cmp(a[field], b[field]) * direction);
    }
    return Promise.resolve(docs[0] ?? null);
  }

  then(onFulfilled, onRejected) {
    return this._exec().then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    return this._exec().catch(onRejected);
  }

  finally(onFinally) {
    return this._exec().finally(onFinally);
  }
}

function withDefaults(doc) {
  const now = new Date();
  return {
    _id: doc._id ?? crypto.randomUUID(),
    type: doc.type,
    status: doc.status ?? 'pending',
    payload: doc.payload,
    attempts: doc.attempts ?? 0,
    maxAttempts: doc.maxAttempts ?? JOB_POLICY.maxAttempts,
    nextAttemptAt: doc.nextAttemptAt ?? now,
    leaseUntil: doc.leaseUntil ?? null,
    startedAt: doc.startedAt ?? null,
    completedAt: doc.completedAt ?? null,
    correlationId: doc.correlationId ?? null,
    errorCategory: doc.errorCategory ?? null,
    errorMessage: doc.errorMessage ?? null,
    expiresAt: doc.expiresAt ?? null,
    createdAt: doc.createdAt ?? now,
    updatedAt: doc.updatedAt ?? now,
  };
}

export function createMemoryJobModel() {
  const store = [];

  return {
    store,

    async create(doc) {
      const created = withDefaults(doc);
      store.push(created);
      return created;
    },

    /** Direct insert for crafting arbitrary states in tests (bypasses schema). */
    insert(doc) {
      const created = withDefaults(doc);
      store.push(created);
      return created;
    },

    findOneAndUpdate(filter, update, options = {}) {
      // Synchronous atomic section (mirrors MongoDB single-document atomicity).
      let candidates = store.filter((doc) => matches(doc, filter));
      if (options.sort && candidates.length > 1) {
        const [field, direction] = Object.entries(options.sort)[0];
        candidates = [...candidates].sort((a, b) => cmp(a[field], b[field]) * direction);
      }
      const winner = candidates[0] ?? null;
      if (winner !== null) {
        applyUpdate(winner, update);
      }
      return new FakeQuery(winner !== null ? [winner] : []);
    },

    async updateMany(filter, update) {
      const matched = store.filter((doc) => matches(doc, filter));
      for (const doc of matched) {
        applyUpdate(doc, update);
      }
      return { matchedCount: matched.length, modifiedCount: matched.length };
    },

    async countDocuments(filter = {}) {
      return store.filter((doc) => matches(doc, filter)).length;
    },

    findOne(filter = {}) {
      return new FakeQuery(store.filter((doc) => matches(doc, filter)));
    },

    async deleteMany(filter = {}) {
      const remaining = store.filter((doc) => !matches(doc, filter));
      store.length = 0;
      store.push(...remaining);
      return { deletedCount: store.length - remaining.length };
    },
  };
}
