import test from 'node:test';
import assert from 'node:assert/strict';
import Task from '../src/models/taskModel.js';
import { cacheService } from '../src/services/cacheService.js';
import { taskController } from '../src/controllers/taskController.js';
import { validateTaskId } from '../src/middleware/validateTaskId.js';
import { authenticateToken } from '../src/middleware/authMiddleware.js';

// Practical 9 cache-behavior tests: no database, no network, no server.
// DB access is stubbed by patching the Mongoose model statics; every patch is
// restored automatically when its test finishes.

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ID_C = 'cccccccccccccccccccccccc';

function makeRes() {
  return {
    statusCode: null,
    body: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
  };
}

const patchRegistry = new WeakMap();

/** Patches a method; all patches from one test restore in reverse order. */
function patch(t, target, name, impl) {
  let list = patchRegistry.get(t);
  if (list === undefined) {
    list = [];
    patchRegistry.set(t, list);
    t.after(() => {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        list[i].target[list[i].name] = list[i].original;
      }
    });
  }
  list.push({ target, name, original: target[name] });
  target[name] = impl;
}

function freshContext() {
  cacheService.flush();
  cacheService.resetStats();
}

function thrower(err) {
  throw err;
}

/** next() callback for middleware success paths: forwards errors, passes success. */
function nextOk(err) {
  if (err) throw err;
}

test('cache: first GET /tasks is a miss that queries the DB, the repeat is a hit that does not', async (t) => {
  freshContext();
  let findCalls = 0;
  patch(t, Task, 'find', async () => {
    findCalls += 1;
    return [{ id: ID_A, title: 'A' }];
  });

  const res1 = makeRes();
  await taskController.getAllTasks({}, res1, thrower);
  assert.equal(res1.statusCode, 200);
  assert.equal(findCalls, 1, 'miss runs exactly one DB query');

  const res2 = makeRes();
  await taskController.getAllTasks({}, res2, thrower);
  assert.equal(res2.statusCode, 200);
  assert.equal(findCalls, 1, 'hit must NOT run another DB query');
  assert.deepEqual(res2.body, res1.body, 'cached payload equals the fresh payload');

  const stats = cacheService.getStats();
  assert.equal(stats.misses, 1);
  assert.equal(stats.hits, 1);
  assert.equal(stats.totalRequests, 2);
  assert.equal(stats.hitRate, 50);
});

test('cache: empty result arrays are cached (repeat request does not query the DB)', async (t) => {
  freshContext();
  let findCalls = 0;
  patch(t, Task, 'find', async () => {
    findCalls += 1;
    return [];
  });

  const res1 = makeRes();
  await taskController.getAllTasks({}, res1, thrower);
  assert.deepEqual(res1.body, []);

  const res2 = makeRes();
  await taskController.getAllTasks({}, res2, thrower);
  assert.equal(findCalls, 1, 'empty array was served from cache');
  assert.deepEqual(res2.body, []);
  assert.equal(cacheService.getStats().hits, 1);
});

test('cache: a database error is not cached and reaches the existing error handler', async (t) => {
  freshContext();
  let findCalls = 0;
  patch(t, Task, 'find', async () => {
    findCalls += 1;
    if (findCalls === 1) throw new Error('db down');
    return [{ id: ID_A }];
  });

  const res1 = makeRes();
  let seenError = null;
  await taskController.getAllTasks({}, res1, (err) => {
    seenError = err;
  });
  assert.ok(seenError instanceof Error, 'error forwarded via next()');
  assert.equal(seenError.message, 'db down');
  assert.equal(res1.statusCode, null, 'no response sent on failure');
  assert.equal(cacheService.getStats().misses, 1);

  // Nothing was cached: the next request queries again and succeeds.
  const res2 = makeRes();
  await taskController.getAllTasks({}, res2, thrower);
  assert.equal(findCalls, 2, 'failed request must not poison the cache');
  assert.equal(res2.statusCode, 200);
  assert.equal(cacheService.getStats().hits, 0, 'recovery request was a miss, not a hit');
  assert.equal(cacheService.getStats().misses, 2);
});

test('cache: GET /tasks/:id uses a per-id key and never serves one id for another', async (t) => {
  freshContext();
  let findByIdCalls = 0;
  patch(t, Task, 'findById', async (id) => {
    findByIdCalls += 1;
    return { id, title: `task ${id}` };
  });

  const reqA1 = { params: { id: ID_A }, method: 'GET' };
  await validateTaskId(reqA1, makeRes(), nextOk);
  assert.equal(findByIdCalls, 1);

  // Repeat id A -> hit, no DB call
  const reqA2 = { params: { id: ID_A }, method: 'GET' };
  await validateTaskId(reqA2, makeRes(), nextOk);
  assert.equal(findByIdCalls, 1, 'repeat id served from cache');
  assert.deepEqual(reqA2.task, reqA1.task);

  // Different id B -> separate entry, DB call happens
  const reqB = { params: { id: ID_B }, method: 'GET' };
  await validateTaskId(reqB, makeRes(), nextOk);
  assert.equal(findByIdCalls, 2, 'a different id must not reuse id A cache');
  assert.equal(reqB.task.id, ID_B);

  const stats = cacheService.getStats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 2);
});

test('cache: cached single-task response serializes identically to the fresh response', async (t) => {
  freshContext();
  const doc = new Task({ title: 'shape parity', description: 'd', priority: 'high' });
  patch(t, Task, 'findById', async () => doc);

  const reqMiss = { params: { id: doc._id.toString() }, method: 'GET' };
  await validateTaskId(reqMiss, makeRes(), nextOk);
  const freshShape = JSON.parse(JSON.stringify(reqMiss.task));

  const reqHit = { params: { id: doc._id.toString() }, method: 'GET' };
  await validateTaskId(reqHit, makeRes(), nextOk);
  const cachedShape = JSON.parse(JSON.stringify(reqHit.task));

  assert.equal(cacheService.getStats().hits, 1, 'second lookup was a cache hit');
  assert.deepEqual(cachedShape, freshShape, 'cache hit must keep the existing response contract');
  assert.equal(cachedShape.id, doc._id.toString(), 'virtual id present');
  assert.equal(cachedShape._id, undefined, '_id still stripped by the schema transform');
  assert.equal(cachedShape.__v, undefined, '__v still stripped by the schema transform');
});

test('cache: cached task list serializes identically to the fresh list', async (t) => {
  freshContext();
  const docs = [new Task({ title: 'one' }), new Task({ title: 'two' })];
  patch(t, Task, 'find', async () => docs);

  const resMiss = makeRes();
  await taskController.getAllTasks({}, resMiss, thrower);
  const freshList = JSON.parse(JSON.stringify(resMiss.body));

  const resHit = makeRes();
  await taskController.getAllTasks({}, resHit, thrower);
  const cachedList = JSON.parse(JSON.stringify(resHit.body));

  assert.equal(cacheService.getStats().hits, 1);
  assert.deepEqual(cachedList, freshList, 'cache hit must keep the existing list contract');
});

test('cache: POST invalidates the list cache only (no id key yet exists)', async (t) => {
  freshContext();
  cacheService.set('tasks:all', [{ id: ID_A }]);
  cacheService.set(`tasks:id:${ID_B}`, { id: ID_B });
  patch(t, Task, 'create', async (doc) => ({ id: ID_C, ...doc }));

  const res = makeRes();
  await taskController.createTask(
    { body: { title: 'new task', description: '', completed: false, priority: 'low' } },
    res,
    thrower
  );
  assert.equal(res.statusCode, 201);
  assert.equal(cacheService.get('tasks:all'), undefined, 'list cache invalidated by POST');
  assert.deepEqual(cacheService.get(`tasks:id:${ID_B}`), { id: ID_B }, 'unrelated id entry kept');
});

test('cache: PUT invalidates both the list cache and the updated id entry', async (t) => {
  freshContext();
  cacheService.set('tasks:all', [{ id: ID_A, title: 'old' }]);
  cacheService.set(`tasks:id:${ID_A}`, { id: ID_A, title: 'old' });
  patch(t, Task, 'findByIdAndUpdate', async () => ({ id: ID_A, title: 'updated' }));

  const res = makeRes();
  await taskController.updateTask(
    { params: { id: ID_A }, body: { title: 'updated' } },
    res,
    thrower
  );
  assert.equal(res.statusCode, 200);
  assert.equal(cacheService.get('tasks:all'), undefined, 'list invalidated by PUT');
  assert.equal(cacheService.get(`tasks:id:${ID_A}`), undefined, 'id entry invalidated by PUT');
});

test('cache: DELETE invalidates both the list cache and the deleted id entry', async (t) => {
  freshContext();
  cacheService.set('tasks:all', [{ id: ID_A }]);
  cacheService.set(`tasks:id:${ID_A}`, { id: ID_A });
  patch(t, Task, 'findByIdAndDelete', async () => ({ id: ID_A }));

  const res = makeRes();
  await taskController.deleteTask({ params: { id: ID_A } }, res, thrower);
  assert.equal(res.statusCode, 200);
  assert.equal(cacheService.get('tasks:all'), undefined, 'list invalidated by DELETE');
  assert.equal(cacheService.get(`tasks:id:${ID_A}`), undefined, 'id entry invalidated by DELETE');
});

test('cache: failed writes keep existing behavior and leave the cache untouched', async (t) => {
  freshContext();
  cacheService.set('tasks:all', [{ id: ID_A }]);
  cacheService.set(`tasks:id:${ID_A}`, { id: ID_A });

  // POST without a title -> existing 400 contract, no invalidation
  const resPost = makeRes();
  await taskController.createTask({ body: { description: 'no title' } }, resPost, thrower);
  assert.equal(resPost.statusCode, 400);
  assert.deepEqual(resPost.body, { error: 'Title is required' });
  assert.deepEqual(cacheService.get('tasks:all'), [{ id: ID_A }], 'cache untouched on 400');

  // PUT on a missing task -> existing 404 contract, no invalidation
  patch(t, Task, 'findByIdAndUpdate', async () => null);
  const resPut = makeRes();
  await taskController.updateTask({ params: { id: ID_A }, body: { title: 'x' } }, resPut, thrower);
  assert.equal(resPut.statusCode, 404);
  assert.deepEqual(resPut.body, { error: 'Task not found' });
  assert.deepEqual(cacheService.get(`tasks:id:${ID_A}`), { id: ID_A }, 'cache untouched on 404');
});

test('cache: PUT/DELETE always validate against the DB (stale id never passes validation)', async (t) => {
  freshContext();
  cacheService.set(`tasks:id:${ID_A}`, { id: ID_A, title: 'cached' });
  let findByIdCalls = 0;
  patch(t, Task, 'findById', async () => {
    findByIdCalls += 1;
    return null; // task no longer exists
  });

  const res = makeRes();
  await validateTaskId({ params: { id: ID_A }, method: 'PUT' }, res, nextOk);
  assert.equal(findByIdCalls, 1, 'write path bypasses the read cache');
  assert.equal(res.statusCode, 404, 'stale cached entry cannot authorize a write');
});

test('cache: statistics — zero-request safety, hit-rate math, invalidation does not reset stats', async (t) => {
  freshContext();

  // Zero requests: no division by zero
  const zero = cacheService.getStats();
  assert.deepEqual(zero, { hits: 0, misses: 0, totalRequests: 0, hitRate: 0 });

  // 1 hit + 3 misses -> 25%
  cacheService.set('k', ['x']);
  cacheService.get('k'); // hit
  cacheService.get('missing-1');
  cacheService.get('missing-2');
  cacheService.get('missing-3');
  const stats = cacheService.getStats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 3);
  assert.equal(stats.totalRequests, 4);
  assert.equal(stats.hitRate, 25);

  // Invalidation must not reset the counters
  cacheService.invalidateTaskCaches(ID_A);
  const after = cacheService.getStats();
  assert.equal(after.hits, 1, 'invalidation preserves hit counter');
  assert.equal(after.misses, 3, 'invalidation preserves miss counter');
  assert.equal(after.hitRate, 25);

  // Stats payload exposes counters only — never cached contents
  assert.deepEqual(Object.keys(after).sort(), ['hitRate', 'hits', 'misses', 'totalRequests']);
});

test('cache: TTL expiry makes an expired entry unavailable (next lookup is a miss)', async (t) => {
  freshContext();
  cacheService.set('tasks:all', [{ id: ID_A }], 0.1); // 100ms TTL

  assert.deepEqual(cacheService.get('tasks:all'), [{ id: ID_A }], 'fresh entry hits');

  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(cacheService.get('tasks:all'), undefined, 'expired entry must miss');
  const stats = cacheService.getStats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 1);
});

test('cache: debug endpoint inputs are protected by authenticateToken (missing/invalid token -> 401)', () => {
  const secret = 'cache-test-secret';
  process.env.JWT_SECRET = secret;

  const resNoHeader = makeRes();
  let nextNoHeader = false;
  authenticateToken({ headers: {} }, resNoHeader, () => {
    nextNoHeader = true;
  });
  assert.equal(nextNoHeader, false);
  assert.equal(resNoHeader.statusCode, 401);

  const resBad = makeRes();
  let nextBad = false;
  authenticateToken({ headers: { authorization: 'Bearer not.a.jwt' } }, resBad, () => {
    nextBad = true;
  });
  assert.equal(nextBad, false, 'invalid token never reaches the stats handler');
  assert.equal(resBad.statusCode, 401);
});
