# Practical 10 — Final Audit Report

**Practical:** 10 — Asynchronous Processing with Event-Driven Architecture
**Date:** 2026-10-25
**Auditor role:** senior Node.js/Express/Mongoose + event-driven architecture & QA
**Scope:** integration of a background notification system built on Node.js's
native `EventEmitter` into the existing Task Management backend, without
breaking Practical 9 or any prior functionality.

---

## A. Executive summary

**Overall status: COMPLETE** (with one pre-existing, unrelated environment
limitation — see BLOCKED rows and section I).

Practical 10 is implemented with three small source files and two minimal
controller edits: a single shared emitter (`taskEvents.js`), a decoupled
listener module registered once at startup (`taskListeners.js`), and two
`safeEmit()` calls placed **after** the existing responses in
`taskController.js`. 15 new automated tests were added; the full unit suite
runs **138/138 passing** (baseline 123 + 15 new). A live run against the
development MongoDB produced real console and client evidence that the API
responded in **74.57 ms** while the notification completed **~2.0 s later**.
Practical 9 caching, invalidation, statistics and authorization behaviour are
unchanged and fully covered by the pre-existing tests.

Remaining limitations are architectural by design (in-process, non-durable
events) and are documented in `docs/practical-10-events.md` §12. The
integration test suite remains blocked by its pre-existing database-guard
refusal (identical before and after this practical).

---

## B. Repository baseline

| Item | Value |
|---|---|
| Working directory | `C:\Users\Admin\Desktop\sem 5\webdev` |
| Branch | `feature/practical-10-events` |
| Initial HEAD | `201b499d99c6eb17809a5e1e33ff01ad19ecb627` — *docs: add Practical 9 commit audit report* |
| Initial working-tree status | 9 modified files, 18 untracked entries (pre-existing uncommitted user work: password-reset/jobs/security/rate-limiter features, their tests, README edits) |
| Module system | ES modules (`"type": "module"` in `backend/package.json`) — verified, not assumed |
| Test framework | `node:test` (`npm test` → `node --test "test/*.test.js"`) |
| Runtime | Node.js v24.12.0 on Windows |
| Database | MongoDB Atlas, dev database `task_manager` (connected successfully during the demo) |

Baseline test results recorded **before** any change:

| Command | Result |
|---|---|
| `cd backend && npm test` | **123 tests, 123 pass, 0 fail** |
| `cd backend && npm run test:integration` | **20 tests, 0 pass, 20 fail** — all `TestDatabaseNotApprovedError` refusals (`RUN_INTEGRATION_TESTS=1` not set). Pre-existing; no connection attempted. |

No lint/type-check/build script exists for the backend. Available project-wide
commands were run (see §E).

---

## C. Files changed

| File | Type | Reason |
|---|---|---|
| `backend/src/events/taskEvents.js` | **new** | Single shared `EventEmitter` instance + guarded `safeEmit()` (no external queue dependency) |
| `backend/src/events/taskListeners.js` | **new** | `task-created`, `task-deleted`, `error` listeners; 2-second non-blocking delay; idempotent `registerTaskListeners()` |
| `backend/src/controllers/taskController.js` | modified | Smallest possible change: guarded `[API]` evidence log + `safeEmit()` **after** the existing 201/200 responses; validation, DB operations, cache invalidation, status codes and bodies untouched |
| `backend/server.js` | modified | +8 lines only: import and one startup call to `registerTaskListeners()`. All other changes in this file pre-existed this practical (email worker / encryption startup) |
| `backend/test/taskEvents.test.js` | **new** | 15 tests (registration, creation, async behaviour, deletion, error handling, Practical 9 regression) |
| `backend/test_practical10.js` | **new** | Ad-hoc runtime demonstration script following the `test_practical9.js` pattern |
| `docs/practical-10-events.md` | **new** | Practical documentation with real console/client evidence |
| `docs/practical-10-audit.md` | **new** | This report |
| `README.md` | modified | 2 additive lines: documentation link + demo-script line. No existing README content removed |

**Not changed:** task routes, models, middlewares (auth, validation, content
type, error handler, logger), `cacheService.js`, `package.json` dependencies,
all pre-existing tests, all pre-existing uncommitted user files.

Git safety: no commit, no push, no `git add`, no reset/checkout/force
operations were performed.

---

## D. Implementation findings (requirement matrix)

| Requirement | Status | Evidence | Fix or Remaining Action |
|---|---|---|---|
| Shared emitter module using Node built-in `events`, one instance for emit + listeners | PASS | `src/events/taskEvents.js` (`class TaskEventBus extends EventEmitter`), asserted by test *“listeners are attached once to the shared emitter”* and by spy-on-shared-emitter tests receiving controller emissions | — |
| No external messaging dependency (no Redis/BullMQ/RabbitMQ), no new npm deps | PASS | `backend/package.json` dependency list unchanged; source imports only `node:events` | — |
| Listeners decoupled in a dedicated module (not in route handlers) | PASS | `src/events/taskListeners.js`; controllers only call `safeEmit()` | — |
| `task-created` listener: title + ISO timestamp + assigned user + `[Notification]` prefix + 2 s delay + completion timestamp | PASS | Runtime log (§F) and tests asserting ISO regex, prefix, start/completion lines | — |
| Assigned user read from the actual task schema | NOT APPLICABLE | `src/models/taskModel.js` has **no** assignment field (`title`, `description`, `completed`, `createdAt`, `priority`). No field name was guessed | If an assignment field is added later, populate `assignedUserId` in the payload |
| “No assigned user” handled gracefully | PASS | Payload `assignedUserId: null`; log line *“has no assigned user (task schema defines no assignment field); requested by \<user-id\>”*; asserted by test | — |
| Non-blocking delay (`await new Promise(r => setTimeout(r, 2000))`), no busy loop | PASS | `delay()` helper in `taskListeners.js`; client response 74.57 ms while handler ran 2005 ms | — |
| `emit()` not awaited by the route; async-listener semantics explained accurately | PASS | Test *“emit() runs listeners synchronously but never awaits their promises”* (completion log absent at response time, promise settles only after `tick(2000)`); docs §7 explains the synchronous prefix of `emit()` | — |
| Emit only after validation + successful DB write + cache invalidation + response; exactly once | PASS | Tests: 400 → 0 events, DB failure → 0 events, success → exactly 1; wiring test asserts `safeEmit` index > `res.status(201).json` index | — |
| Payload built from the persisted task, minimal fields | PASS | Tests assert exact payload `{taskId,title,assignedUserId,createdBy}` / `{taskId,title,deletedBy}`; `Object.keys` asserted | — |
| Listener cannot access response objects / cause a second HTTP response | PASS | Listeners receive plain payloads only; test *“a throwing listener cannot alter or duplicate the 201 response”* asserts `jsonCalls === 1`, `next()` untouched | — |
| `task-deleted` listener distinct, logged, emitted only after successful delete | PASS | Runtime logs (§F); tests: missing task → 0 events (404), failed delete → 0 events, success → exactly 1 with exact payload | — |
| Deletion response, status, body and cache invalidation preserved | PASS | Tests assert `200` + `{"message":"Task deleted successfully"}` + both cache keys cleared; runtime shows same contract | — |
| Minimal notification data available after delete without extra query or API change | PASS | Payload built from the document returned by `findByIdAndDelete()`; response body unchanged | — |
| Listeners registered exactly once at startup, not per request | PASS | `server.js` contains exactly one `registerTaskListeners()` call (asserted); `registerTaskListeners()` is idempotent (2nd/3rd calls return `false`, `listenerCount === 1`) | — |
| Event registration kept separate from route implementation | PASS | Registration lives in `server.js` + `taskListeners.js`; controllers only emit | — |
| `error` listener registered before any emission; special `error` event never emitted unhandled | PASS | Registration order: `error` first; `safeEmit` would catch an unhandled case; test *“the special error event cannot crash the app”* | — |
| Async listener rejections caught and logged without crashing the server | PASS | Whole handler bodies wrapped in `try/catch` → `reportFailure()`; tests use `assert.doesNotReject` for both handlers; `server.js` `unhandledRejection` handler (process-exit) never triggered during the live run | — |
| Error handling does not recurse | PASS | Re-entrancy flag + inner `try/catch` in `onError`; test asserts **exactly one** logging attempt per emission even when `console.error` throws | — |
| Notification failure never reported as an API/database failure; original response preserved | PASS | `safeEmit()` + guarded `logApiEvent()`; tests for create and delete paths assert `nextErr === null`, status 201/200, `jsonCalls === 1` | — |
| Practical 9: all-task caching, single-task caching, hit/miss correctness | PASS | All 14 pre-existing `cache.test.js` tests still pass; live demo shows miss 28.00 ms → hit 4.19 ms after creation | — |
| Practical 9: POST/PUT/DELETE invalidation | PASS | Pre-existing tests + new regression test with listeners active | — |
| Practical 9: statistics correct and debug endpoint still authenticated | PASS | Pre-existing stats/auth tests pass; live demo: unauthenticated `/debug/cache-stats` → **401**, authenticated stats `{hits:1,misses:1,totalRequests:2,hitRate:50}` | — |
| No duplicate task routes / DB operations introduced | PASS | `taskRoutes.js` untouched; controller performs the same single `create`/`findByIdAndDelete` call; no new route registered | — |
| Ownership/authorization/validation/error handling preserved | PASS | `authenticateToken`, `validateTaskId`, validation branch and error middleware untouched; pre-existing auth/regression tests pass | — |
| Automated tests for registration, creation, async, deletion, error handling, P9 regression | PASS | 15 new tests in `test/taskEvents.test.js`, all passing (§E) | — |
| Deterministic timers instead of fragile wall-clock assertions | PASS | `t.mock.timers.enable({apis:['setTimeout']})` + `tick(2000)`; total suite ≈ 2 s | — |
| Existing tests not deleted or weakened | PASS | Test-file diff: only the new file added; baseline 123 assertions intact and passing | — |
| Runtime demonstration with real logs, real client timings | PASS | §F — two live runs against the dev database | — |
| Practical documentation created, existing docs untouched | PASS | `docs/practical-10-events.md` (new), README +2 additive lines | — |
| Final audit report with this matrix | PASS | This file | — |
| No commits / pushes, no destructive git, user work preserved | PASS | `git status` shows the same 9 pre-existing modified files (only `README.md` gained 2 additive lines) plus this practical's new files; nothing staged or committed | — |
| Backend lint / type-check commands run | NOT APPLICABLE | `backend/package.json` defines only `start`, `dev`, `test`, `test:integration` — no lint or type-check script exists | Add ESLint/TypeScript only if the course requires it |
| Integration test suite run | BLOCKED (pre-existing) | `npm run test:integration` → 20/20 refused by `test/helpers/dbGuard.js` because `RUN_INTEGRATION_TESTS=1` + an approved `*_test` database are not configured. Identical before/after; no Practical 10 integration test exists | Configure an approved isolated test database if DB-backed integration tests are required |
| End-to-end integration tests against a real DB for the event flow | PARTIAL | Covered instead by (a) unit tests with stubbed Mongoose statics and (b) the live demo script | Optional: add a guarded integration test once a test database is approved |

---

## E. Test results (actual commands and counts)

| # | Command | Result | When |
|---|---|---|---|
| 1 | `cd backend && npm test` (baseline) | **123 pass / 0 fail**, ~2.02 s | before implementation |
| 2 | `cd backend && npm run test:integration` (baseline) | 0 pass / **20 fail** — all `TestDatabaseNotApprovedError` refusals | before implementation |
| 3 | `cd backend && node --test test/taskEvents.test.js` | **15 pass / 0 fail** | after implementation |
| 4 | `cd backend && npm test` (final) | **138 pass / 0 fail** (123 + 15), ~2.09 s | after implementation |
| 5 | `cd backend && npm run test:integration` (final) | 0 pass / **20 fail** — same refusal reason, unchanged baseline | after implementation |
| 6 | `npm run frontend:lint` (`eslint .`) | passed, no findings | after implementation |
| 7 | `npm run frontend:build` | `✓ built in 350ms` | after implementation |

New test breakdown (`backend/test/taskEvents.test.js`, 15 tests):

1. registration — listeners attached once; repeated registration is a no-op
2. wiring — `server.js` calls `registerTaskListeners()` exactly once; emit occurs after the response in both controllers
3. creation — exactly one event, exact payload, 201 contract, start log before tick / completion after tick
4. creation — validation failure (400) emits nothing
5. creation — DB failure emits nothing
6. creation — throwing listener cannot alter or duplicate the 201 response
7. async — `emit()` synchronous, promise not awaited, delay non-blocking, completion after controlled tick
8. deletion — exactly one event with exact payload keys, response + cache invalidation preserved, distinct handler logs
9. deletion — missing task (404) emits nothing
10. deletion — failed DB delete emits nothing
11. error handling — rejected async listener contained and reported once
12. error handling — special `error` event never crashes; no recursion (logger failure included)
13. error handling — deleted listener contains and reports its own failures
14. error handling — delete-path notification failure produces no second HTTP response
15. Practical 9 regression — POST invalidation + statistics correct with listeners active

Failures introduced by this implementation: **0**. Baseline failures: **0**
(unit suite) and **20 pre-existing environment refusals** (integration suite).

---

## F. Runtime evidence (live, 2026-10-25)

Setup: `cd backend && npm start` (server PID 27352, MongoDB connected,
`Server running in development mode on port 5000 - 2026-10-25T13:46:29Z`),
then `node test_practical10.js` in a second shell.

**Client output (real `fetch` timings):**

```text
client request sent at   : 2026-10-25T13:46:40.198Z
HTTP status              : 201
response payload id      : 6ade08409d4e8999d5224ce6
response payload title   : Practical 10 event notification demo
client received at       : 2026-10-25T13:46:40.273Z
client-measured duration : 74.57 ms
NOTE: ... the client response did NOT wait for it (duration 74.57 ms vs 2000 ms delay)

GET /tasks #1 (after POST invalidated the cache): 28.00 ms, 5 tasks
GET /tasks #2 (cache hit): 4.19 ms, 5 tasks
cache stats after create: {"hits":1,"misses":1,"totalRequests":2,"hitRate":50}

DELETE /tasks/:id -> 200 {"message":"Task deleted successfully"} (54.63 ms)
DELETE same id again -> 404 {"error":"Task not found"}
unauthenticated GET /debug/cache-stats -> 401
```

**Server console (same run):**

```text
[API] POST /tasks response initiation at 2026-10-25T13:46:40.269Z (status 201)
[Notification] Task-created handler started at 2026-10-25T13:46:40.271Z
[Notification] Task "Practical 10 event notification demo" has no assigned user (task schema defines no assignment field); requested by 6ade083f9d4e8999d5224ce5
POST /tasks 201 74.1ms [73951bff-...] 2026-10-25T13:46:40Z
[Notification] Task-created handler completed at 2026-10-25T13:46:42.276Z (taskId=6ade08409d4e8999d5224ce6)
[API] DELETE /tasks/:id response initiation at 2026-10-25T13:46:43.862Z (status 200)
[Notification] Task-deleted handler started at 2026-10-25T13:46:43.862Z
[Notification] Task "Practical 10 event notification demo" (taskId=6ade08409d4e8999d5224ce6) deleted by 6ade083f9d4e8999d5224ce5
[Notification] Task-deleted handler completed at 2026-10-25T13:46:43.863Z
DELETE /tasks/6ade08409d4e8999d5224ce6 200 55.0ms ...
DELETE /tasks/6ade08409d4e8999d5224ce6 404 19.7ms ...
```

**Interpretation (labelled precisely):**

| Fact | Measurement |
|---|---|
| Task persisted | `id = 6ade08409d4e8999d5224ce6`, HTTP 201 |
| Server-side response initiation | `13:46:40.269Z` (logged immediately before `res.json()`) |
| Listener start (synchronous prefix of `emit()`) | `13:46:40.271Z` — +2 ms |
| Client received response | `13:46:40.273Z`, **74.57 ms** total round trip |
| Notification completed | `13:46:42.276Z` — **2005 ms** after start, ≈ 2003 ms after the client already had its response |
| Deletion event | own handler, own start/completion lines, distinct payload |
| Duplicate/failed events | second DELETE → 404 with **no** `task-deleted` notification logged |

An earlier independent run produced: initiation `13:44:37.058Z`, start
`13:44:37.059Z`, completion `13:44:39.071Z`, client duration **337.30 ms** —
same conclusion, no waiting for the 2 s delay.

No timestamps, IDs, durations or logs above are fabricated; they come from the
captured console output and the script's `performance.now()` measurements.
The demonstration account created by the script
(`test_events_<timestamp>@example.com`) and its demo task (created then
deleted) are the only database writes; **no pre-existing record was modified**.

---

## G. Practical 9 regression results

| Area | Result |
|---|---|
| All-task caching (miss → DB → cache, repeat → hit) | PASS — pre-existing tests + live demo (28.00 ms miss → 4.19 ms hit) |
| Single-task caching (`tasks:id:<id>`) | PASS — pre-existing tests unchanged |
| Empty-result caching, DB-error not cached | PASS |
| POST invalidates `tasks:all` only | PASS — pre-existing test + new test with listeners active |
| PUT invalidates list + id entry | PASS — pre-existing test (PUT emits no event) |
| DELETE invalidates list + id entry | PASS — pre-existing test + new deletion test |
| Stale id never serves a write path | PASS |
| Statistics math (hit rate, zero-request safety, invalidation does not reset counters) | PASS |
| `/debug/cache-stats` behind `authenticateToken` (401 without token) | PASS — pre-existing test + live 401 |
| Task controller surface (5 async methods) unchanged | PASS |
| Ownership / authorization / validation / error handling | PASS — all pre-existing auth and regression tests pass |

Total unit tests: **138 pass / 0 fail** — i.e. every pre-existing assertion is
intact, none deleted or weakened.

---

## H. Security and error handling

Findings:

1. **No new attack surface.** No new routes, no new dependencies, no new
   network listeners. Task authentication (`authenticateToken`) still precedes
   every task operation, including the ones that emit events.
2. **Minimal event payloads.** Payloads contain only an id, a title and a
   user id. No request bodies, tokens, passwords, JWTs, e-mail addresses or
   job payloads are emitted or logged.
3. **Listener isolation.** Three independent guards (`try/catch` inside
   handlers, `reportFailure` fallback, `safeEmit` at the emit site) ensure a
   notification failure can never alter an HTTP response, call `next()`, or
   reach the process-level `unhandledRejection` handler (which exits the
   process).
4. **Special `error` event safety.** The listener is registered before any
   emission is possible; the handler is re-entrancy-guarded and never throws,
   so an unhandled `'error'` (a classic Node crash) is impossible.
5. **Evidence logging off the critical path.** `[API]` logs are wrapped in
   `logApiEvent()`; a stdout failure cannot convert a successful database
   write into an error response (discovered by a test during this practical
   and fixed).
6. **Graceful unassigned-user handling** avoids inventing or leaking a field
   that does not exist.

Remaining risks / notes:

- Notification failures are logged only (no retry, no alerting) — acceptable
  for a lab application, not for production.
- Notification logs include task titles and user ids on the server console;
  this matches the practical's requirement, but log access should be
  restricted in production.
- The demo script registers real users in the dev database (same pattern as
  the pre-existing `test_practical9.js`); these accounts are inert and
  contain no personal data.

---

## I. Limitations

1. **In-process, non-durable events.** Events live only in memory: a process
   crash or redeploy between `emit()` and notification completion loses the
   notification, with no replay or dead-letter mechanism.
2. **Single instance only.** Independent server instances do not share the
   emitter; a listener on instance B never sees instance A's events.
3. **No retries/back-pressure/ordering guarantees across failures.** If a
   listener throws synchronously during `emit()`, remaining listeners for that
   emission are skipped (`safeEmit` logs it).
4. **Integration tests remain blocked** by the pre-existing database guard
   (`RUN_INTEGRATION_TESTS=1` and an approved `*_test` URI are not configured).
   This was equally true before Practical 10; the event flow is covered by
   unit tests plus the live demonstration instead.
5. **No backend lint/type-check command exists** in this repository, so none
   could be run for the backend (frontend lint + build were run and pass).
6. **Two demo accounts** were created in the dev database by the two demo
   runs (`test_events_1792935875027@…`, `test_events_1792935999783@…`);
   their demo tasks were created and deleted. There is no user-deletion
   endpoint in the existing API, so the accounts remain (same as the
   pre-existing Practical 9 demo accounts).

---

## J. Final verdict

**COMPLETE.**

- All Functional requirements of Practical 10 are implemented and verified by
  passing tests and live runtime evidence (see matrix in §D).
- Practical 9 behaviour is fully preserved (138/138 unit tests).
- No unrelated user work was modified; nothing was committed or pushed.
- Outstanding items are environmental/pre-existing (integration test database
  guard) or explicitly out of scope by instruction (message queue, durability).

---

## K. Commit recommendation

Nothing has been committed. When authorized, a suitable single commit would be:

```text
feat: add event-driven task notifications
```

Suggested staged files:

```text
backend/src/events/taskEvents.js
backend/src/events/taskListeners.js
backend/src/controllers/taskController.js
backend/server.js
backend/test/taskEvents.test.js
backend/test_practical10.js
docs/practical-10-events.md
docs/practical-10-audit.md
README.md
```

Note: `backend/server.js` and `README.md` also contain the user's earlier
uncommitted work (email worker/practical docs) — stage them only if that work
is intended to be part of the same commit; otherwise commit this practical's
files first and leave the rest to the user's own commit plan.

---

**Post-audit update — commit task executed.** This report was written before
the authorized commit task; the statements above about "nothing committed"
describe the implementation phase. The recommendation was carried out as three
grouped, path-scoped commits (this documentation commit is the third):

| Group | Message | Contents |
|---|---|---|
| A | `feat: add event-driven task notifications` | `backend/src/events/taskEvents.js`, `backend/src/events/taskListeners.js`, `backend/src/controllers/taskController.js`, and the Practical 10 hunks of `backend/server.js` |
| B | `test: cover asynchronous task event handling` | `backend/test/taskEvents.test.js`, `backend/test_practical10.js` |
| C | `docs: document Practical 10 implementation and audit` | `docs/practical-10-events.md`, `docs/practical-10-audit.md`, and the two Practical 10 lines of `README.md` |

`backend/server.js` and `README.md` were staged **partially** so the
pre-existing unrelated work stayed uncommitted — exactly what the note above
advises. Nothing was pushed. Hashes, test results and final repository status:
`docs/practical-10-commit-audit.md`.
