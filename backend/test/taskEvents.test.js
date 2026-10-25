import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import taskEvents, { safeEmit } from '../src/events/taskEvents.js';
import {
  NOTIFICATION_DELAY_MS,
  registerTaskListeners,
  handleTaskCreated,
  handleTaskDeleted,
} from '../src/events/taskListeners.js';
import { taskController } from '../src/controllers/taskController.js';
import Task from '../src/models/taskModel.js';
import { cacheService } from '../src/services/cacheService.js';

// Practical 10 event-driven notification tests: no database, no network, no
// server. DB access is stubbed by patching the Mongoose model statics; every
// patch and console override is restored automatically when its test finishes.
// The two-second notification delay is driven with node:test mock timers, so
// assertions are deterministic instead of wall-clock based.

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ID_C = 'cccccccccccccccccccccccc';

function makeRes() {
  return {
    statusCode: null,
    body: undefined,
    headers: {},
    jsonCalls: 0,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonCalls += 1;
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

/** Captures console output for log-format assertions; restored after the test. */
function captureConsole(t) {
  const logs = { log: [], error: [] };
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.log.push(args.join(' '));
  console.error = (...args) => logs.error.push(args.join(' '));
  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
  });
  return logs;
}

/** Collects payloads emitted on a shared-emitter event; removed after the test. */
function spyOn(t, event) {
  const received = [];
  const listener = (payload) => received.push(payload);
  taskEvents.on(event, listener);
  t.after(() => taskEvents.removeListener(event, listener));
  return received;
}

/** Drains microtasks (and one macrotask turn) so awaited continuations run. */
async function flushAsync() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

/** Controls the listener's setTimeout so tests never wait two real seconds. */
function useMockTimers(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
}

// ---------------------------------------------------------------------------
// A. Event registration
// ---------------------------------------------------------------------------

test('registration: listeners are attached once to the shared emitter (repeated setup cannot duplicate them)', () => {
  assert.equal(taskEvents.listenerCount('task-created'), 0, 'nothing registered before startup registration');
  assert.equal(taskEvents.listenerCount('task-deleted'), 0);
  assert.equal(taskEvents.listenerCount('error'), 0);

  assert.equal(registerTaskListeners(), true, 'first call registers');
  assert.equal(registerTaskListeners(), false, 'second call is a no-op');
  assert.equal(registerTaskListeners(), false, 'third call is a no-op');

  assert.equal(taskEvents.listenerCount('task-created'), 1, 'exactly one task-created listener');
  assert.equal(taskEvents.listenerCount('task-deleted'), 1, 'exactly one task-deleted listener');
  assert.equal(taskEvents.listenerCount('error'), 1, 'error listener registered before any emission');
});

test('wiring: server registers listeners at startup; controllers emit on the shared emitter after the response', async () => {
  const serverSource = await readFile(fileURLToPath(new URL('../server.js', import.meta.url)), 'utf8');
  const registrationCalls = serverSource.match(/registerTaskListeners\(\)/g) || [];
  assert.equal(registrationCalls.length, 1, 'server.js calls registerTaskListeners() exactly once');

  const controllerSource = await readFile(
    fileURLToPath(new URL('../src/controllers/taskController.js', import.meta.url)),
    'utf8'
  );
  assert.match(controllerSource, /import \{ safeEmit \} from '\.\.\/events\/taskEvents\.js'/);
  assert.match(controllerSource, /safeEmit\('task-created'/, 'create emits task-created');
  assert.match(controllerSource, /safeEmit\('task-deleted'/, 'delete emits task-deleted');

  const createResponseIdx = controllerSource.indexOf('res.status(201).json(newTask)');
  const createEmitIdx = controllerSource.indexOf("safeEmit('task-created'");
  assert.ok(createResponseIdx !== -1, 'existing 201 response present');
  assert.ok(createEmitIdx > createResponseIdx, 'task-created is emitted AFTER the response');

  const deleteResponseIdx = controllerSource.indexOf('res.status(200).json(');
  const deleteEmitIdx = controllerSource.indexOf("safeEmit('task-deleted'");
  assert.ok(deleteResponseIdx !== -1, 'existing delete response present');
  assert.ok(deleteEmitIdx > deleteResponseIdx, 'task-deleted is emitted AFTER the response');
});

// ---------------------------------------------------------------------------
// B. Task creation
// ---------------------------------------------------------------------------

test('creation: exactly one task-created event, 201 contract preserved, notification not awaited', async (t) => {
  useMockTimers(t);
  freshContext();
  const logs = captureConsole(t);
  const created = spyOn(t, 'task-created');

  const persisted = { id: ID_C, title: 'Prepare report', description: '', completed: false, priority: 'high' };
  patch(t, Task, 'create', async () => ({ ...persisted }));

  const res = makeRes();
  let nextErr = null;
  await taskController.createTask(
    { body: { title: 'Prepare report' }, user: { id: 'user-123' } },
    res,
    (err) => {
      nextErr = err;
    }
  );

  // Existing response contract unchanged
  assert.equal(nextErr, null);
  assert.equal(res.statusCode, 201);
  assert.equal(res.jsonCalls, 1, 'exactly one HTTP response');
  assert.deepEqual(res.body, persisted, 'response body is still the persisted task document');

  // Exactly one event, payload from the persisted document (not the request body)
  assert.equal(created.length, 1, 'exactly one task-created event per creation');
  assert.deepEqual(created[0], {
    taskId: ID_C,
    title: 'Prepare report',
    assignedUserId: null,
    createdBy: 'user-123',
  });

  // Async behaviour: handler started synchronously, completion NOT awaited
  const started = logs.log.filter((l) => l.includes('Task-created handler started at'));
  const completedBeforeTick = logs.log.filter((l) => l.includes('Task-created handler completed at'));
  assert.equal(started.length, 1, 'listener began executing synchronously during emit()');
  assert.match(started[0], /started at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'ISO timestamp logged');
  const assignmentLine = logs.log.find((l) => l.includes('assigned user'));
  assert.ok(assignmentLine, 'assignment information logged');
  assert.ok(
    assignmentLine.includes('has no assigned user') && assignmentLine.includes('requested by user-123'),
    'assignment handled gracefully (schema has no assignment field) and requester logged'
  );
  assert.equal(completedBeforeTick.length, 0, 'route returned without waiting for the two-second delay');

  // Controlled timer: the listener eventually completes after the delay
  t.mock.timers.tick(NOTIFICATION_DELAY_MS);
  await flushAsync();
  const completedAfterTick = logs.log.filter((l) => l.includes('Task-created handler completed at'));
  assert.equal(completedAfterTick.length, 1, 'listener completes once its timer fires');
  assert.match(completedAfterTick[0], /completed at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'ISO completion timestamp');
  assert.ok(completedAfterTick[0].includes(`taskId=${ID_C}`));
});

test('creation: validation failure emits no task-created event (existing 400 contract)', async (t) => {
  useMockTimers(t);
  freshContext();
  const created = spyOn(t, 'task-created');
  patch(t, Task, 'create', async () => {
    throw new Error('Task.create must not run when the title is missing');
  });

  const res = makeRes();
  let nextErr = null;
  await taskController.createTask({ body: { description: 'no title' } }, res, (err) => {
    nextErr = err;
  });

  assert.equal(nextErr, null);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Title is required' });
  assert.equal(created.length, 0, 'no event for a rejected creation');
});

test('creation: a failed database write emits no task-created event (existing error path)', async (t) => {
  useMockTimers(t);
  freshContext();
  const created = spyOn(t, 'task-created');
  patch(t, Task, 'create', async () => {
    throw new Error('db down');
  });

  const res = makeRes();
  let nextErr = null;
  await taskController.createTask({ body: { title: 'will fail' } }, res, (err) => {
    nextErr = err;
  });

  assert.ok(nextErr instanceof Error, 'error still forwarded via next()');
  assert.equal(nextErr.message, 'db down');
  assert.equal(res.statusCode, null, 'no response sent on failure');
  assert.equal(res.jsonCalls, 0);
  assert.equal(created.length, 0, 'no event for a failed write');
});

test('creation: a throwing listener cannot alter or duplicate the 201 response', async (t) => {
  useMockTimers(t);
  freshContext();
  const originalLog = console.log;
  const originalError = console.error;
  const errorLogs = [];
  console.log = () => {};
  console.error = (...args) => errorLogs.push(args.join(' '));
  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  const boom = () => {
    throw new Error('listener exploded');
  };
  taskEvents.on('task-created', boom);
  t.after(() => taskEvents.removeListener('task-created', boom));

  patch(t, Task, 'create', async () => ({ id: ID_C, title: 'T' }));

  const res = makeRes();
  let nextErr = null;
  await taskController.createTask({ body: { title: 'T' }, user: { id: 'u1' } }, res, (err) => {
    nextErr = err;
  });

  assert.equal(nextErr, null, 'listener failure never reaches next()');
  assert.equal(res.statusCode, 201, 'the already-successful response is preserved');
  assert.equal(res.jsonCalls, 1, 'no second HTTP response');
  assert.equal(safeEmit('task-created', {}), false, 'safeEmit reports the listener failure');
  assert.ok(
    errorLogs.some((l) => l.includes('listener failure while emitting "task-created"') && l.includes('listener exploded')),
    'failure logged instead of thrown'
  );
});

// ---------------------------------------------------------------------------
// C. Asynchronous behaviour
// ---------------------------------------------------------------------------

test('async: emit() runs listeners synchronously but never awaits their promises; the delay is non-blocking', async (t) => {
  useMockTimers(t);
  const logs = captureConsole(t);

  let settled = false;
  const emitted = safeEmit('task-created', {
    taskId: 'task-async',
    title: 'Async demo',
    assignedUserId: null,
    createdBy: 'user-7',
  });
  assert.equal(emitted, true, 'emit completed even though the listener is still running');

  await flushAsync();
  const completedBeforeTick = logs.log.filter((l) => l.includes('handler completed at'));
  assert.equal(
    completedBeforeTick.length,
    0,
    'emit() returned while the async listener was still pending (it does not await the promise)'
  );

  let pending = handleTaskCreated({ taskId: 'task-async-2', title: 'Direct', createdBy: 'user-7' });
  pending.then(() => {
    settled = true;
  });
  await flushAsync();
  assert.equal(settled, false, 'promise still pending after the synchronous prefix');
  assert.equal(
    logs.log.filter((l) => l.includes('Task-created handler started at')).length >= 1,
    true,
    'start log written synchronously before the first await'
  );

  t.mock.timers.tick(NOTIFICATION_DELAY_MS);
  await flushAsync();
  assert.equal(settled, true, 'listener completes after the non-blocking timer fires');
  assert.ok(
    logs.log.some((l) => /Task-created handler completed at \d{4}-\d{2}-\d{2}T/.test(l)),
    'completion timestamp logged'
  );
  await pending;
});

// ---------------------------------------------------------------------------
// D. Task deletion
// ---------------------------------------------------------------------------

test('deletion: exactly one task-deleted event with the expected payload; response and cache invalidation preserved', async (t) => {
  useMockTimers(t);
  freshContext();
  const logs = captureConsole(t);
  const deleted = spyOn(t, 'task-deleted');

  cacheService.set('tasks:all', [{ id: ID_A }]);
  cacheService.set(`tasks:id:${ID_A}`, { id: ID_A });
  patch(t, Task, 'findByIdAndDelete', async () => ({ id: ID_A, title: 'Old task' }));

  const res = makeRes();
  let nextErr = null;
  await taskController.deleteTask({ params: { id: ID_A }, user: { id: 'user-9' } }, res, (err) => {
    nextErr = err;
  });

  assert.equal(nextErr, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonCalls, 1, 'exactly one HTTP response');
  assert.deepEqual(res.body, { message: 'Task deleted successfully' });

  assert.equal(deleted.length, 1, 'exactly one task-deleted event per successful deletion');
  assert.deepEqual(deleted[0], {
    taskId: ID_A,
    title: 'Old task',
    deletedBy: 'user-9',
  });
  assert.deepEqual(
    Object.keys(deleted[0]).sort(),
    ['deletedBy', 'taskId', 'title'],
    'payload carries only the minimal notification fields'
  );

  // Practical 9 invalidation untouched
  assert.equal(cacheService.get('tasks:all'), undefined, 'list cache still invalidated by DELETE');
  assert.equal(cacheService.get(`tasks:id:${ID_A}`), undefined, 'id cache still invalidated by DELETE');

  // Distinct deletion notification with its own listener
  assert.ok(
    logs.log.some((l) => l.includes('Task-deleted handler started at')),
    'deletion handler logged its own start'
  );
  assert.ok(
    logs.log.some((l) => l.includes('Task-deleted handler completed at')),
    'deletion handler logged its own completion'
  );
  assert.ok(
    !logs.log.some((l) => l.includes('Task-created handler')),
    'the deletion path does not trigger the creation notification'
  );
});

test('deletion: a missing task (404) emits no task-deleted event', async (t) => {
  useMockTimers(t);
  freshContext();
  const deleted = spyOn(t, 'task-deleted');
  patch(t, Task, 'findByIdAndDelete', async () => null);

  const res = makeRes();
  let nextErr = null;
  await taskController.deleteTask({ params: { id: ID_A }, user: { id: 'user-9' } }, res, (err) => {
    nextErr = err;
  });

  assert.equal(nextErr, null);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'Task not found' });
  assert.equal(deleted.length, 0, 'no success event for a no-op deletion');
});

test('deletion: a failed database delete emits no task-deleted event', async (t) => {
  useMockTimers(t);
  freshContext();
  const deleted = spyOn(t, 'task-deleted');
  patch(t, Task, 'findByIdAndDelete', async () => {
    throw new Error('db down');
  });

  const res = makeRes();
  let nextErr = null;
  await taskController.deleteTask({ params: { id: ID_A } }, res, (err) => {
    nextErr = err;
  });

  assert.ok(nextErr instanceof Error);
  assert.equal(nextErr.message, 'db down');
  assert.equal(res.statusCode, null, 'no response sent on failure');
  assert.equal(res.jsonCalls, 0);
  assert.equal(deleted.length, 0, 'no event for a failed deletion');
});

// ---------------------------------------------------------------------------
// E. Error handling
// ---------------------------------------------------------------------------

test('error handling: a rejected async listener is contained and reported on the error event', async (t) => {
  const originalLog = console.log;
  const originalError = console.error;
  const errorLogs = [];
  console.log = () => {
    throw new Error('stdout unavailable');
  };
  console.error = (...args) => errorLogs.push(args.join(' '));
  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  const reported = spyOn(t, 'error');

  // EventEmitter does not observe promises returned by async listeners: the
  // handler must swallow its own failure instead of rejecting.
  await assert.doesNotReject(
    handleTaskCreated({ taskId: 't-err', title: 'Broken', createdBy: 'u1' }),
    'listener failure must not escape as a rejected promise'
  );

  assert.equal(reported.length, 1, 'failure surfaced exactly once on the error event');
  assert.equal(reported[0].message, 'stdout unavailable');
  assert.equal(errorLogs.length, 1, 'notification failure logged once');
  assert.match(errorLogs[0], /^\[Notification\] async notification error: Error: stdout unavailable/);
});

test('error handling: the special error event cannot crash the app and error handling does not recurse', async (t) => {
  const originalError = console.error;
  let attempts = 0;
  console.error = () => {
    attempts += 1;
    throw new Error('logger down');
  };
  t.after(() => {
    console.error = originalError;
  });

  // With the registered error listener, emitting 'error' never throws —
  // even when the logging itself fails inside the handler.
  assert.doesNotThrow(() => taskEvents.emit('error', new Error('boom')));
  assert.equal(attempts, 1, 'exactly one guarded attempt: no recursion');

  assert.equal(safeEmit('error', new Error('boom-2')), true, 'safeEmit also survives');
  assert.equal(attempts, 2, 'still one attempt per emission');
});

test('error handling: the deleted listener also contains and reports its own failures', async (t) => {
  const originalLog = console.log;
  const originalError = console.error;
  const errorLogs = [];
  console.log = () => {
    throw new Error('stdout unavailable');
  };
  console.error = (...args) => errorLogs.push(args.join(' '));
  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  const reported = spyOn(t, 'error');

  await assert.doesNotReject(
    handleTaskDeleted({ taskId: 't-x', title: 'Broken delete', deletedBy: 'u1' }),
    'deleted-listener failure must not escape as a rejected promise'
  );
  assert.equal(reported.length, 1, 'failure reported exactly once');
  assert.equal(reported[0].message, 'stdout unavailable');
  assert.match(errorLogs[0], /^\[Notification\] async notification error: Error: stdout unavailable/);
});

test('error handling: notification failure never produces a second HTTP response on the delete path', async (t) => {
  useMockTimers(t);
  freshContext();
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {
    throw new Error('stdout unavailable');
  };
  console.error = () => {}; // failure log kept out of the runner output
  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  patch(t, Task, 'findByIdAndDelete', async () => ({ id: ID_A, title: 'Old task' }));

  const res = makeRes();
  let nextErr = null;
  await taskController.deleteTask({ params: { id: ID_A }, user: { id: 'user-9' } }, res, (err) => {
    nextErr = err;
  });

  assert.equal(nextErr, null, 'async notification failure must not reach the error middleware');
  assert.equal(res.statusCode, 200, 'the already-successful delete response is preserved');
  assert.equal(res.jsonCalls, 1, 'exactly one response — no duplicate send');
});

// ---------------------------------------------------------------------------
// F. Practical 9 regression (caching with the event system active)
// ---------------------------------------------------------------------------

test('regression: POST still invalidates the list cache and cache statistics stay correct with listeners active', async (t) => {
  useMockTimers(t);
  freshContext();
  const originalLog = console.log;
  console.log = () => {};
  t.after(() => {
    console.log = originalLog;
  });

  cacheService.set('tasks:all', [{ id: ID_A }]);
  cacheService.set(`tasks:id:${ID_A}`, { id: ID_A });
  patch(t, Task, 'create', async (doc) => ({ id: ID_C, ...doc }));

  const res = makeRes();
  let nextErr = null;
  await taskController.createTask({ body: { title: 'cache + events' }, user: { id: 'u1' } }, res, (err) => {
    nextErr = err;
  });

  assert.equal(nextErr, null);
  assert.equal(res.statusCode, 201, 'existing POST contract unchanged');
  assert.equal(cacheService.get('tasks:all'), undefined, 'list cache invalidated by POST');
  assert.deepEqual(cacheService.get(`tasks:id:${ID_A}`), { id: ID_A }, 'unrelated id entry kept');

  const stats = cacheService.getStats();
  assert.equal(stats.misses, 1, 'the invalidated list lookup still counts as a miss');
  assert.equal(stats.hits, 1, 'the untouched id entry still counts as a hit');
  assert.equal(stats.totalRequests, 2);
  assert.equal(typeof stats.hitRate, 'number');
});
