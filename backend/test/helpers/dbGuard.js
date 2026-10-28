/**
 * Safety guard for database integration tests.
 *
 * Integration tests must NEVER touch the development (or any real) database.
 * This module resolves a connection target ONLY when every isolation condition
 * holds, and otherwise throws TestDatabaseNotApprovedError with the exact
 * configuration required. The guard runs BEFORE any connection attempt, so a
 * refusal means zero network activity to MongoDB.
 *
 * Conditions enforced:
 *   1. NODE_ENV must not be 'production'.
 *   2. RUN_INTEGRATION_TESTS=1 — an explicit, temporary opt-in.
 *   3. TEST_MONGO_URI is configured (tests never read MONGO_URI for connecting).
 *   4. The URI has a mongodb:// or mongodb+srv:// scheme.
 *   5. The URI names an explicit database matching the allowlist: [a-z0-9]…_test
 *      (this also rejects URI-less connections, whose driver-default database
 *      would be 'test'/'dev').
 *   6. TEST_MONGO_URI differs from MONGO_URI, and the test database name differs
 *      from the development database name (case-insensitive).
 *
 * The guard never echoes either URI or any credential — only database names.
 */

export const ISOLATED_DB_NAME_PATTERN = /^[a-z0-9][a-z0-9_]*_test$/;

export class TestDatabaseNotApprovedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TestDatabaseNotApprovedError';
  }
}

/** Extracts the database name (path segment) from a MongoDB URI, or null. */
export function extractDbName(uri) {
  if (typeof uri !== 'string') return null;
  try {
    const parsed = new URL(uri.trim());
    if (parsed.protocol !== 'mongodb:' && parsed.protocol !== 'mongodb+srv:') return null;
    const path = parsed.pathname.replace(/^\//, '');
    const dbSegment = path.split('/')[0] ?? '';
    if (dbSegment.length === 0) return null;
    return decodeURIComponent(dbSegment);
  } catch {
    // Fallback for any URI WHATWG URL cannot parse: raw path regex.
    const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?#]*)/.exec(uri.trim());
    if (!match) return null;
    const dbSegment = (match[1] ?? '').split('/')[0];
    return dbSegment.length > 0 ? dbSegment : null;
  }
}

function refusal(reason, devDbName) {
  const devHint = devDbName === null ? '(not configured)' : devDbName;
  return new TestDatabaseNotApprovedError(
    [
      'Database integration tests REFUSED — no isolated test database is approved.',
      `Reason: ${reason}`,
      '',
      'Exact configuration required (backend/.env):',
      '  RUN_INTEGRATION_TESTS=1',
      '  TEST_MONGO_URI=mongodb://<user>:<password>@<host>:27017/<name>_test?authSource=admin',
      '',
      'Rules enforced by test/helpers/dbGuard.js:',
      '  - TEST_MONGO_URI is used ONLY by tests; the application reads MONGO_URI.',
      `  - database name must match <name>_test and differ from the dev database (${devHint})`,
      '  - RUN_INTEGRATION_TESTS=1 is an explicit opt-in; remove it to disable database tests',
      '  - NODE_ENV must not be production',
      '  - the two URIs must not be identical',
      '',
      'No connection was attempted. URI values are never printed by this guard.',
    ].join('\n')
  );
}

/**
 * Returns { uri, dbName } when the isolated test database is fully approved,
 * otherwise throws TestDatabaseNotApprovedError. Call before EVERY connection
 * and again before EVERY destructive operation.
 */
export function resolveIsolatedTestDb(env = process.env) {
  const rawMongo = typeof env.MONGO_URI === 'string' ? env.MONGO_URI.trim() : '';
  const devDbName = rawMongo.length > 0 ? extractDbName(rawMongo) : null;

  if (env.NODE_ENV === 'production') {
    throw refusal('NODE_ENV is production — database tests are never allowed there', devDbName);
  }

  if (env.RUN_INTEGRATION_TESTS !== '1') {
    throw refusal('RUN_INTEGRATION_TESTS=1 opt-in is not set', devDbName);
  }

  const uri = typeof env.TEST_MONGO_URI === 'string' ? env.TEST_MONGO_URI.trim() : '';
  if (uri.length === 0) {
    throw refusal('TEST_MONGO_URI is not configured', devDbName);
  }

  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw refusal('TEST_MONGO_URI is not a mongodb:// or mongodb+srv:// URI', devDbName);
  }

  const dbName = extractDbName(uri);
  if (dbName === null) {
    throw refusal('TEST_MONGO_URI does not name an explicit database (…/<name>_test)', devDbName);
  }

  if (!ISOLATED_DB_NAME_PATTERN.test(dbName)) {
    throw refusal(
      `test database name "${dbName}" does not match the allowlist <name>_test`,
      devDbName
    );
  }

  if (rawMongo.length > 0) {
    if (uri === rawMongo) {
      throw refusal('TEST_MONGO_URI is identical to MONGO_URI (the development database)', devDbName);
    }
    if (devDbName !== null && devDbName.toLowerCase() === dbName.toLowerCase()) {
      throw refusal(
        `test database name "${dbName}" is the same as the development database`,
        devDbName
      );
    }
  }

  return { uri, dbName };
}
