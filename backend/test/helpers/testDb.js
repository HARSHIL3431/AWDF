import dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  ISOLATED_DB_NAME_PATTERN,
  TestDatabaseNotApprovedError,
  resolveIsolatedTestDb,
} from './dbGuard.js';

// Load backend/.env so the guard can always compare TEST_MONGO_URI against the
// configured development MONGO_URI, even in test files that never import the
// app config. Only variable PRESENCE matters here; no value is ever printed.
dotenv.config();

/**
 * Guarded MongoDB access for integration tests.
 *
 * - connectTestDb() resolves the guard BEFORE calling mongoose.connect, so a
 *   refusal performs zero connections. After connecting it verifies the LIVE
 *   database name matches the approved name and disconnects immediately on
 *   any mismatch.
 * - wipeIsolatedData() re-runs the guard and re-checks the live connection's
 *   database name immediately before any destructive deleteMany.
 *
 * Destructive scope is limited to the explicit collection list — never
 * dropDatabase(), never collection drops.
 */

export async function connectTestDb(env = process.env) {
  const target = resolveIsolatedTestDb(env); // throws BEFORE any I/O

  await mongoose.connect(target.uri, { serverSelectionTimeoutMS: 5000 });

  const actual = mongoose.connection.db?.databaseName ?? null;
  if (actual !== target.dbName) {
    await mongoose.disconnect();
    throw new TestDatabaseNotApprovedError(
      `Connected database "${actual}" does not match approved test database "${target.dbName}" — disconnected immediately.`
    );
  }
  if (!ISOLATED_DB_NAME_PATTERN.test(actual)) {
    await mongoose.disconnect();
    throw new TestDatabaseNotApprovedError(
      `Live database "${actual}" fails the <name>_test allowlist — disconnected immediately.`
    );
  }
  return { dbName: target.dbName };
}

export async function disconnectTestDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

/** Destructive: deletes documents in the given collections of the LIVE
 *  connection only after re-verifying the guard and the live database name. */
export async function wipeIsolatedData(collectionNames = ['jobs', 'users']) {
  resolveIsolatedTestDb(); // re-verify at destructive-op time

  if (mongoose.connection.readyState !== 1) {
    throw new Error('wipeIsolatedData: no active MongoDB connection');
  }
  const liveDbName = mongoose.connection.db?.databaseName ?? '';
  if (!ISOLATED_DB_NAME_PATTERN.test(liveDbName)) {
    throw new TestDatabaseNotApprovedError(
      `wipeIsolatedData refused: live database "${liveDbName}" is not an approved *_test database`
    );
  }

  for (const name of collectionNames) {
    await mongoose.connection.db.collection(name).deleteMany({});
  }
}
