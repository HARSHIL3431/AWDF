# Practical 10: Asynchronous Processing with Event-Driven Architecture

## 1. Objective

Decouple slow notification work from the task HTTP endpoints using Node.js's
**built-in `events` module** (`EventEmitter`):

- `POST /tasks` and `DELETE /tasks/:id` respond exactly as before.
- After the response has been initiated, a `task-created` / `task-deleted`
  event is emitted on a **single shared emitter**.
- Notification listeners live in their own module and run asynchronously with a
  simulated two-second processing delay — without delaying the API response.

No Redis, BullMQ, RabbitMQ or any other messaging dependency was added.
No new npm package was installed (`backend/package.json` dependencies are
unchanged by this practical).

---

## 2. Architecture

```text
POST /tasks
    |
    v
Validate request + authenticate (unchanged)
    |
    v
Task.create(...)  -> MongoDB                       (unchanged)
    |
    v
cacheService.invalidateTaskCaches()                (Practical 9, unchanged)
    |
    v
[API] log: response initiation timestamp           (new, guarded)
    |
    v
res.status(201).json(task)                         (unchanged contract)
    |
    v
safeEmit('task-created', minimal payload)          (new, after response)
    |
    +--> [Notification] handler started  (synchronous prefix of emit)
    |
    +--> await delay(2000)  <-- non-blocking timer, event loop stays free
    |
    +--> [Notification] handler completed
```

```text
DELETE /tasks/:id
    |
    v
validateTaskId + authorization (unchanged) -> 404 when missing (no event)
    |
    v
Task.findByIdAndDelete(id)                         (unchanged)
    |
    v
cacheService.invalidateTaskCaches(id)              (Practical 9, unchanged)
    |
    v
[API] log + res.status(200).json({...})            (unchanged contract)
    |
    v
safeEmit('task-deleted', minimal payload)          (new, after response)
    |
    +--> [Notification] deletion handler start / notification / completion
```

Files:

| File | Role |
|---|---|
| `backend/src/events/taskEvents.js` | The single shared `EventEmitter` instance (`taskEvents`) plus the guarded `safeEmit()` helper |
| `backend/src/events/taskListeners.js` | `task-created`, `task-deleted` and `error` listeners + idempotent `registerTaskListeners()` |
| `backend/src/controllers/taskController.js` | Emits the events after the existing responses (smallest possible change) |
| `backend/server.js` | Calls `registerTaskListeners()` **once** at startup |
| `backend/test/taskEvents.test.js` | 15 automated tests for registration, creation, async behaviour, deletion, error handling, Practical 9 regression |
| `backend/test_practical10.js` | Ad-hoc runtime demonstration script (requires a running server) |

Module system: the backend is **ES modules** (`"type": "module"` in
`backend/package.json`), so the event modules use `import`/`export` — not the
CommonJS `require` shown in generic examples.

---

## 3. The shared EventEmitter module

`backend/src/events/taskEvents.js`:

```javascript
import { EventEmitter } from 'node:events';

class TaskEventBus extends EventEmitter {}

export const taskEvents = new TaskEventBus();

export function safeEmit(event, payload) {
  try {
    taskEvents.emit(event, payload);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Notification] listener failure while emitting "${event}": ${message}`);
    return false;
  }
}

export default taskEvents;
```

Design points:

- **One instance only.** Routes emit on it, listeners subscribe to it. A second
  emitter created anywhere else would silently receive no events.
- **`safeEmit()` isolates the HTTP path.** `emit()` runs listeners
  *synchronously*; a listener that throws synchronously would otherwise bubble
  into the controller's `try/catch` and could trigger a **second** response
  attempt after `res.json()` had already been sent. `safeEmit` catches that,
  logs it, and returns `false` — the API result is never changed by a
  notification failure.
- No external queue, no extra dependency.

---

## 4. Listener registration (once, at startup)

`backend/src/events/taskListeners.js` exports `registerTaskListeners()`,
called exactly once from `backend/server.js` right after the app is created:

```javascript
import { registerTaskListeners } from './src/events/taskListeners.js';

const app = express();
registerTaskListeners();   // idempotent — repeated calls are no-ops
```

```javascript
export function registerTaskListeners() {
  if (listenersRegistered) return false;
  listenersRegistered = true;
  taskEvents.on('error', onError);            // registered FIRST
  taskEvents.on('task-created', handleTaskCreated);
  taskEvents.on('task-deleted', handleTaskDeleted);
  return true;
}
```

- Listeners are **never** registered inside a route handler, so registration
  cannot grow per request.
- The function is **idempotent** (`listenersRegistered` flag): a repeated call
  — repeated test setup, double import, restart semantics — cannot duplicate
  listener execution. Verified by test (`listenerCount(...) === 1`).
- The special `error` event listener is attached **before** any emission is
  possible, so an unhandled `'error'` (which would throw and crash the process)
  can never occur.

---

## 5. Events, payloads and log format

### 5.1 `task-created`

Emitted only after a successful `Task.create()` and only after the 201
response. Not emitted for validation failures (400) or database failures
(`next(error)`), and never twice per creation.

Payload (built from the **persisted** document, never from raw request fields):

```javascript
{
  taskId: newTask?.id ?? null,          // e.g. "6ade08409d4e8999d5224ce6"
  title: newTask?.title ?? null,        // trimmed/persisted title
  assignedUserId: null,                 // see 5.3
  createdBy: req.user?.id ?? null       // authenticated requester (JWT id)
}
```

### 5.2 `task-deleted`

Emitted only after `findByIdAndDelete()` actually removed a record (the 404
branch returns first), exactly once per successful deletion:

```javascript
{
  taskId: deletedTask?.id ?? id,        // from the returned document
  title: deletedTask?.title ?? null,
  deletedBy: req.user?.id ?? null
}
```

The deletion data comes from the document returned by `findByIdAndDelete()`, so
no extra query is needed and the API response body is unchanged.

### 5.3 The assigned-user field

The task schema (`backend/src/models/taskModel.js`) defines **no assignment
field** — its fields are `title`, `description`, `completed`, `createdAt`,
`priority`. Tasks in this application are not assigned to users. Instead of
guessing a field name such as `assignedUser` / `assignedTo` / `userId`, the
payload carries `assignedUserId: null` explicitly and the listener handles that
case gracefully by naming the authenticated requester:

```text
[Notification] Task "Practical 10 event notification demo" has no assigned user (task schema defines no assignment field); requested by 6ade083f9d4e8999d5224ce5
```

### 5.4 Log format

All notification lines are prefixed with `[Notification]` and use ISO-8601
timestamps:

```text
[Notification] Task-created handler started at 2026-10-25T13:46:40.271Z
[Notification] Task "<title>" assigned to <user>            (when assigned)
[Notification] Task "<title>" has no assigned user ...; requested by <user-id>
[Notification] Task-created handler completed at 2026-10-25T13:46:42.276Z (taskId=<id>)
[Notification] Task-deleted handler started at 2026-10-25T13:46:43.862Z
[Notification] Task "<title>" (taskId=<id>) deleted by <user-id>
[Notification] Task-deleted handler completed at 2026-10-25T13:46:43.863Z
[Notification] async notification error: Error: ...          (failure path)
```

Only the notification's minimal data is logged: no passwords, tokens, JWTs,
request bodies or payload contents.

---

## 6. Why the two-second timer does not block the event loop

```javascript
await new Promise((resolve) => setTimeout(resolve, 2000));
```

`setTimeout` registers a timer with Node's event loop and returns immediately.
The listener function suspends at the `await`, the event loop keeps processing
other sockets/timers/requests for the full two seconds, and only then is the
continuation resumed to print the completion line. There is **no busy loop and
no synchronous sleep** — the process's throughput is unaffected, which is why
the measured POST duration stayed in the tens of milliseconds while the
notification ran for two seconds.

## 7. Why `emit()` does not await async listeners

`EventEmitter.emit()` **synchronously** calls each registered listener in
registration order and ignores whatever they return. When a listener is
`async`, its returned Promise is simply dropped:

- everything **before the listener's first `await`** runs inside the caller's
  stack (that is why the "handler started" line appears immediately after
  `emit()`);
- everything after the first `await` is deferred to the microtask/timer queue;
- `emit()` does **not** wait for the Promise to settle, and it is **not** the
  case that `emit()` moves work to another thread — it is all still the same
  single thread, just interleaved.

Consequences that this implementation embraces:

- The controller **does not** `await` the listener: the response is already
  sent before the notification's slow part runs.
- EventEmitter **cannot observe a rejected Promise** from an `async` listener.
  Therefore every handler wraps its entire body in `try/catch` — a rejection
  can never escape and reach `process.on('unhandledRejection')` in
  `server.js` (which terminates the process).
- Because `emit()` is synchronous, the "handler started" log can appear *before*
  the HTTP response bytes reach the client. That is expected and is not a
  contradiction: the request does not wait for the handler's two-second
  completion.

---

## 8. Error handling

Layered, deliberately simple (no event framework):

1. **Inside each listener** — the whole body is wrapped in `try/catch`; the
   catch calls `reportFailure()`, so an async listener never rejects.
2. **`reportFailure()`** emits the special `error` event; if the `error`
   listener is missing or itself fails, it falls back to a guarded
   `console.error`. It never rethrows.
3. **`onError` listener** — registered first at startup, guarded by a
   re-entrancy flag and an inner `try/catch`, so:
   - an unhandled `'error''` emission (which would throw) is impossible;
   - a failure inside the logger cannot escape `emit()`;
   - handling cannot recurse (exactly one attempt per emission — asserted by
     test).
4. **`safeEmit()` in the controller** — catches a synchronously throwing
   listener so the already-sent response is never affected and `next()` is
   never called with a notification error.
5. **`logApiEvent()` in the controller** — the evidence log is guarded so a
   stdout failure cannot turn a successful database operation into an error
   response.

A notification failure therefore **never** produces a second HTTP response and
never misreports a successful database operation as failed.

---

## 9. Coexistence with Practical 9 (caching)

Nothing about the cache design changed:

| Behaviour | Status with Practical 10 active |
|---|---|
| `GET /tasks` miss → DB → cache, repeat → hit | unchanged |
| `GET /tasks/:id` per-id cache | unchanged |
| `POST` invalidates `tasks:all` | unchanged (runs before the emit) |
| `PUT` invalidates `tasks:all` + `tasks:id:<id>` | unchanged (no event on PUT) |
| `DELETE` invalidates `tasks:all` + `tasks:id:<id>` | unchanged (runs before the emit) |
| `/debug/cache-stats` counters & `authenticateToken` guard | unchanged |
| Ownership/authorization/validation/error handling | unchanged |

The event bus does **not** replace persistence or cache invalidation, and
emitting an event invalidates nothing extra: cache invalidation stays exactly
where it was in the controller.

---

## 10. Tests

```bash
cd backend
npm test            # unit tests, includes test/taskEvents.test.js
```

Actual result (2026-10-25, Node v24.12.0):

```text
ℹ tests 138
ℹ pass 138
ℹ fail 0
```

- Baseline before this practical: **123 pass / 0 fail**.
- New tests added by Practical 10: **15** (`backend/test/taskEvents.test.js`).
- `npm run test:integration` remains at its pre-existing baseline:
  **20 tests, 0 pass, 20 fail** — every failure is the documented
  `TestDatabaseNotApprovedError` refusal (`RUN_INTEGRATION_TESTS=1` is not
  set). No integration test was added or modified, and this failure is
  unrelated to Practical 10.

Coverage of the new tests:

| Area | What is asserted |
|---|---|
| Registration | one listener per event on the shared emitter; repeated registration is a no-op; `server.js` calls `registerTaskListeners()` exactly once |
| Wiring | controllers import `safeEmit` from the shared module; emit happens **after** `res.status(201).json(...)` / `res.status(200).json(...)` |
| Creation success | exactly one event, payload from the persisted document, status 201 + body unchanged, start log present **before** the timer fires, completion log **absent** until `tick(2000)` |
| Creation failure | validation failure (400) and DB failure emit nothing |
| Listener throws | response stays 201, `json()` called exactly once, `next()` untouched, `safeEmit` returns `false` and logs |
| Async behaviour | `safeEmit` returns while the listener Promise is still pending; the promise settles only after the (mocked) timer ticks — no wall-clock sleeps |
| Deletion | exactly one `task-deleted` with the exact payload keys `deletedBy`, `taskId`, `title`; 404 and DB failure emit nothing; cache invalidation still happens; the deletion path does not trigger the creation handler |
| Error handling | listener failures are contained (`doesNotReject`) and reported once on `error`; emitting `error` never throws even when the logger itself throws; no recursion; delete-path notification failure does not create a second response |
| Practical 9 regression | POST still invalidates `tasks:all`, keeps the unrelated id entry, and hit/miss statistics remain correct with listeners registered |

The two-second delay is driven by `t.mock.timers` (`tick(2000)`), so the suite
is deterministic and finishes in ~2 s total; no fragile wall-clock assertions
are used.

---

## 11. Runtime demonstration

### How to run

```bash
cd backend
npm start                      # terminal 1: server (MongoDB required)
node test_practical10.js       # terminal 2: demonstration script
```

`test_practical10.js` registers a throwaway account
(`test_events_<timestamp>@example.com`), creates **one** demo task, waits for
the notification, checks Practical 9 caching, deletes that task, then deletes
it again (expected 404). **No pre-existing task or user record is modified.**

### Actual client output (2026-10-25)

```text
3. Creating a task (POST /tasks)...
   client request sent at   : 2026-10-25T13:46:40.198Z
   HTTP status              : 201
   response payload id      : 6ade08409d4e8999d5224ce6
   response payload title   : Practical 10 event notification demo
   client received at       : 2026-10-25T13:46:40.273Z
   client-measured duration : 74.57 ms
   NOTE: the notification handler needs ~2000 ms; the client response did NOT wait for it (duration 74.57 ms vs 2000 ms delay)
...
6. Deleting the demo task (DELETE /tasks/:id)...
   HTTP status              : 200
   response payload         : {"message":"Task deleted successfully"}
   client-measured duration : 54.63 ms
7. Deleting the same id again (expected 404, no task-deleted event)...
   HTTP status: 404 body: {"error":"Task not found"}
```

### Actual server console output (same run)

```text
[API] POST /tasks response initiation at 2026-10-25T13:46:40.269Z (status 201)
[Notification] Task-created handler started at 2026-10-25T13:46:40.271Z
[Notification] Task "Practical 10 event notification demo" has no assigned user (task schema defines no assignment field); requested by 6ade083f9d4e8999d5224ce5
POST /tasks 201 74.1ms [73951bff-cda2-41ae-87ff-8dd5e84842cf] 2026-10-25T13:46:40Z
[Notification] Task-created handler completed at 2026-10-25T13:46:42.276Z (taskId=6ade08409d4e8999d5224ce6)
[API] DELETE /tasks/:id response initiation at 2026-10-25T13:46:43.862Z (status 200)
[Notification] Task-deleted handler started at 2026-10-25T13:46:43.862Z
[Notification] Task "Practical 10 event notification demo" (taskId=6ade08409d4e8999d5224ce6) deleted by 6ade083f9d4e8999d5224ce5
[Notification] Task-deleted handler completed at 2026-10-25T13:46:43.863Z
DELETE /tasks/6ade08409d4e8999d5224ce6 200 55.0ms ...
DELETE /tasks/6ade08409d4e8999d5224ce6 404 19.7ms ...
```

### What the numbers prove

| Evidence | Value |
|---|---|
| Response initiation (server) | `13:46:40.269Z` |
| Listener start (synchronous prefix of `emit`) | `13:46:40.271Z` (+2 ms) |
| Client received the 201 response | `13:46:40.273Z`, measured **74.57 ms** |
| Listener completed | `13:46:42.276Z` — **2005 ms** after start |
| Gap: client response → notification completion | **~2003 ms** (client was served long before the notification finished) |
| Deletion | response initiation `13:46:43.862Z`, distinct handler start/completion logs, second DELETE → 404 with no notification |

The client's 74.57 ms is the full round trip; the `[API]` line is the
server-side initiation timestamp. They are labelled separately and are not
claimed to be the same instant.

An earlier run of the same script measured 337.30 ms for the POST (network
variance) with the same conclusion: `13:44:37.058Z` initiation,
`13:44:37.059Z` start, `13:44:39.071Z` completion.

---

## 12. Limitations (in-process EventEmitter)

- **Not durable.** Events exist only in process memory. If the process
  terminates between `emit()` and the listener's completion (crash, `SIGKILL`,
  deployment), that notification is lost forever. There is no persistence, no
  replay, no dead-letter queue.
- **Not shared across instances.** With two server processes behind a load
  balancer, the listener registered on instance A never sees events emitted on
  instance B.
- **No ordering/back-pressure guarantees across failures** beyond Node's
  in-order synchronous dispatch: a listener that throws during `emit()` stops
  the remaining listeners for that emission.
- **No retries.** A failed notification is logged once and dropped.
- **Process-wide single consumer.** Multiple listeners work, but there is no
  work-queue semantics (no competing consumers, no acknowledgement).
- **The two-second delay is a simulation** of slow notification work, not a
  business requirement.

### Why this is still the right choice here

For a small lab/teaching application — one Node process, low volume, best-effort
notifications — the built-in `EventEmitter` gives true decoupling of the
notification concern from the request path with **zero** infrastructure and zero
added dependencies. For a production system needing guaranteed, durable,
ordered, cross-instance delivery (high-volume event processing), this design
should be replaced by a real broker (e.g. RabbitMQ, Kafka, or a Redis-backed
queue with persistent jobs). **No message queue was introduced for this
assignment**, by design.
