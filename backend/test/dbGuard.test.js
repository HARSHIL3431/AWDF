import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ISOLATED_DB_NAME_PATTERN,
  TestDatabaseNotApprovedError,
  extractDbName,
  resolveIsolatedTestDb,
} from './helpers/dbGuard.js';

// Refusal matrix: every unsafe/absent configuration must throw the typed error
// and every message must include the exact configuration remediation.
function refuseWith(env, reasonPattern) {
  let caught = null;
  try {
    resolveIsolatedTestDb(env);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught !== null, 'expected the guard to refuse');
  assert.ok(caught instanceof TestDatabaseNotApprovedError, 'typed refusal error');
  assert.match(caught.message, /REFUSED/);
  assert.match(caught.message, /RUN_INTEGRATION_TESTS=1/);
  assert.match(caught.message, /TEST_MONGO_URI/);
  assert.match(caught.message, /No connection was attempted/);
  if (reasonPattern) assert.match(caught.message, reasonPattern);
  return caught;
}

test('guard: empty environment is refused (no opt-in, no URI)', () => {
  refuseWith({}, /RUN_INTEGRATION_TESTS=1 opt-in is not set/);
});

test('guard: opt-in without TEST_MONGO_URI is refused', () => {
  refuseWith({ RUN_INTEGRATION_TESTS: '1' }, /TEST_MONGO_URI is not configured/);
});

test('guard: wrong opt-in value is refused (must be exactly "1")', () => {
  refuseWith(
    { RUN_INTEGRATION_TESTS: 'true', TEST_MONGO_URI: 'mongodb://localhost/x_test' },
    /opt-in is not set/
  );
});

test('guard: production NODE_ENV refuses even when fully configured', () => {
  refuseWith(
    {
      NODE_ENV: 'production',
      RUN_INTEGRATION_TESTS: '1',
      TEST_MONGO_URI: 'mongodb://localhost:27017/task_manager_test',
      MONGO_URI: 'mongodb://localhost:27017/task_manager',
    },
    /NODE_ENV is production/
  );
});

test('guard: non-mongodb scheme is refused', () => {
  refuseWith(
    { RUN_INTEGRATION_TESTS: '1', TEST_MONGO_URI: 'postgres://localhost/thing_test' },
    /not a mongodb/
  );
});

test('guard: URI without an explicit database name is refused', () => {
  refuseWith(
    { RUN_INTEGRATION_TESTS: '1', TEST_MONGO_URI: 'mongodb://localhost:27017/' },
    /does not name an explicit database/
  );
  refuseWith(
    { RUN_INTEGRATION_TESTS: '1', TEST_MONGO_URI: 'mongodb://user:pw@host:27017' },
    /does not name an explicit database/
  );
});

test('guard: dev database name and missing _test suffix are refused', () => {
  refuseWith(
    {
      RUN_INTEGRATION_TESTS: '1',
      TEST_MONGO_URI: 'mongodb://localhost:27017/task_manager',
      MONGO_URI: 'mongodb://localhost:27017/other',
    },
    /allowlist <name>_test/
  );
  refuseWith(
    {
      RUN_INTEGRATION_TESTS: '1',
      TEST_MONGO_URI: 'mongodb://localhost:27017/test',
      MONGO_URI: 'mongodb://localhost:27017/task_manager',
    },
    /allowlist <name>_test/
  );
  refuseWith(
    {
      RUN_INTEGRATION_TESTS: '1',
      TEST_MONGO_URI: 'mongodb://localhost:27017/_test',
      MONGO_URI: 'mongodb://localhost:27017/task_manager',
    },
    /allowlist <name>_test/
  );
});

test('guard: TEST_MONGO_URI identical to MONGO_URI is refused', () => {
  refuseWith(
    {
      RUN_INTEGRATION_TESTS: '1',
      TEST_MONGO_URI: 'mongodb://localhost:27017/task_manager_test',
      MONGO_URI: 'mongodb://localhost:27017/task_manager_test',
    },
    /identical to MONGO_URI/
  );
});

test('guard: same database name as development (case-insensitive) is refused', () => {
  refuseWith(
    {
      RUN_INTEGRATION_TESTS: '1',
      TEST_MONGO_URI: 'mongodb://localhost:27017/task_manager_test',
      MONGO_URI: 'mongodb://localhost:27017/Task_Manager_TEST',
    },
    /same as the development database/
  );
});

test('guard: refusal messages never leak credentials or URI values', () => {
  const secret = 'super-secret-db-password-XYZ';
  let message = '';
  try {
    resolveIsolatedTestDb({
      RUN_INTEGRATION_TESTS: '1',
      TEST_MONGO_URI: `mongodb://appuser:${secret}@cluster.example.com/task_manager`,
      MONGO_URI: `mongodb://appuser:${secret}@cluster.example.com/task_manager_dev`,
    });
  } catch (err) {
    message = String(err.message);
  }
  assert.ok(message.length > 0);
  assert.ok(!message.includes(secret), 'password must never be echoed');
  assert.ok(!message.includes('cluster.example.com'), 'host must never be echoed');
  assert.ok(!message.includes('appuser'), 'username must never be echoed');
});

test('guard: fully approved configuration resolves with parsed db name', () => {
  const cases = [
    {
      env: {
        RUN_INTEGRATION_TESTS: '1',
        TEST_MONGO_URI: 'mongodb://localhost:27017/task_manager_test',
        MONGO_URI: 'mongodb://localhost:27017/task_manager',
      },
      dbName: 'task_manager_test',
    },
    {
      env: {
        RUN_INTEGRATION_TESTS: '1',
        TEST_MONGO_URI:
          'mongodb+srv://user:pw@cluster.example.com/qa_integration_test?retryWrites=true&w=majority',
        MONGO_URI: 'mongodb+srv://user:pw@cluster.example.com/task_manager',
      },
      dbName: 'qa_integration_test',
    },
    {
      // No MONGO_URI at all (fresh environment) still requires _test naming.
      env: {
        RUN_INTEGRATION_TESTS: '1',
        TEST_MONGO_URI: 'mongodb://127.0.0.1:27017/local_dev_test',
      },
      dbName: 'local_dev_test',
    },
  ];
  for (const { env, dbName } of cases) {
    const resolved = resolveIsolatedTestDb(env);
    assert.equal(resolved.dbName, dbName);
    assert.equal(resolved.uri, env.TEST_MONGO_URI);
  }
});

test('extractDbName: parses schemes correctly and rejects foreign schemes', () => {
  assert.equal(extractDbName('mongodb://h:27017/my_db_test'), 'my_db_test');
  assert.equal(extractDbName('mongodb://u:p@h/my_db_test?opt=1'), 'my_db_test');
  assert.equal(extractDbName('mongodb+srv://h/cluster_test'), 'cluster_test');
  assert.equal(extractDbName('mongodb://h:27017/'), null);
  assert.equal(extractDbName('mongodb://h:27017'), null);
  assert.equal(extractDbName('postgres://h/db'), null);
  assert.equal(extractDbName('not a uri'), null);
  assert.equal(extractDbName(null), null);
});

test('allowlist pattern shape', () => {
  assert.equal(ISOLATED_DB_NAME_PATTERN.test('task_manager_test'), true);
  assert.equal(ISOLATED_DB_NAME_PATTERN.test('t_test'), true);
  assert.equal(ISOLATED_DB_NAME_PATTERN.test('Task_Manager_Test'), false);
  assert.equal(ISOLATED_DB_NAME_PATTERN.test('task-manager_test'), false);
  assert.equal(ISOLATED_DB_NAME_PATTERN.test('testing'), false);
  assert.equal(ISOLATED_DB_NAME_PATTERN.test('_test'), false);
});
