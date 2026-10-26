# Practical 13 - Secure AI Task Description Generator

Implementation of an AI feature inside the existing Task Management application:
an authenticated user types a task title, presses **Generate description**, and
the backend asks an LLM for a short description that is placed in the editable
description field. Nothing is saved until the user presses **Add Task**.

Everything below was produced in this repository. Where a result was not
observed it is marked as pending instead of being claimed.

---

## 1. Objective and theory

The practical asks for an AI feature that is genuinely useful but does not hand
the provider key, the user's data or the application's reliability to a third
party. The three requirements that drive the whole design are:

1. **The key never reaches the browser.** Vite inlines every `VITE_*` variable
   into the JavaScript bundle that any visitor can download. A provider key in a
   `VITE_*` variable is therefore a published key. The key is read only from the
   backend process environment.
2. **The provider is optional at runtime.** If the key is missing, the quota is
   exhausted, the network is down or the model returns nonsense, task management
   must keep working exactly as before. The AI feature degrades; the app does not.
3. **AI output is a suggestion, not an action.** The text is shown in an editable
   field with a visible disclaimer and is never submitted automatically.

The AI call is made server-side, from our own Express process, so that the key
exists in exactly one place and every failure can be translated into a stable,
client-safe response.

---

## 2. Architecture

```
Browser (React)
   |  POST /api/ai/generate-description   { title }        Authorization: Bearer <app JWT>
   v
Express (our backend)  ----------------------------------------------  backend/server.js
   |  app.use('/api/ai', aiRoutes)
   v
routes/aiRoutes.js
   |  1. authenticateToken      (same policy as task creation -> 401)
   |  2. aiRateLimiter          (per-task 1/min, per-user 10/min -> 429)
   |  3. controller.generate    (validation -> 400)
   v
controllers/aiController.js
   |  calls the service, maps every outcome to one stable JSON shape
   v
services/aiDescriptionService.js
   |  provider = AI_PROVIDER (openai | gemini)
   |  key      = OPENAI_API_KEY | GEMINI_API_KEY   (backend env only)
   |  request  = title only, key in a HEADER, AbortController timeout
   v
https://api.openai.com/v1/chat/completions        (OpenAI)
https://generativelanguage.googleapis.com/...     (Gemini)
```

Files added by this practical:

| File | Responsibility |
| --- | --- |
| `backend/src/services/aiDescriptionService.js` | Provider calls, timeout, fixed error messages, output sanitising |
| `backend/src/middleware/aiRateLimiter.js` | Process-local per-task and per-account limits, injectable clock, bounded map |
| `backend/src/controllers/aiController.js` | Validation and the 200 / 400 / 503 response contract |
| `backend/src/routes/aiRoutes.js` | Auth -> limiter -> handler wiring, mountable factory for tests |
| `backend/test/aiGeneration.test.js` | 25 mocked tests (no key, no network, no cost) |
| `frontend/src/services/aiService.js` | Browser -> our backend only |
| `frontend/src/pages/Tasks.jsx` | Button, loading state, disclaimer (additive change) |
| `backend/server.js` | One import and one `app.use('/api/ai', ...)` mount |
| `backend/.env.example` | Empty placeholders for the provider settings |

The application has **no global `/api` prefix** (auth is mounted at `/`, tasks at
`/tasks`), so the router is mounted at `/api/ai` to make the documented path
resolve to exactly `/api/ai/generate-description` without touching an existing
route.

Layer order is deliberate: authentication runs **before** the limiter, so an
unauthenticated caller can never consume another user's quota.

---

## 3. Endpoint contract

`POST /api/ai/generate-description`

Request (authenticated, `Content-Type: application/json`):

```json
{ "title": "Prepare database backup" }
```

| Situation | Status | Body |
| --- | --- | --- |
| AI text produced | `200` | `{ "description": "...", "fallback": false, "message": "AI suggestion generated. Review it before using." }` |
| Provider-side failure (missing/invalid key, timeout, quota, network, malformed output, unexpected exception) | `503` | `{ "description": "", "fallback": true, "message": "AI suggestions are temporarily unavailable. You can enter the description manually." }` |
| Title missing / not a string / longer than 200 characters | `400` | `{ "error": "Title is required" }` |
| No or invalid application token | `401` | `{ "error": "Access token required" }` |
| Same title requested again within 60 s, or more than 10 AI requests per minute | `429` | `{ "error": "..." }` + `Retry-After: <seconds>` |

Notes on the contract:

* The body shape is **uniform** in both the success and the degraded case, so
  the frontend has one branch to render and never has to parse a provider error.
* `fallback: true` is the machine-readable signal that no AI text is present.
* Nothing from the provider is echoed: no provider message, no status detail, no
  error code, no stack trace, no headers.

### Why 503 and not 200

Returning `200` for "the provider failed" would make a broken integration
invisible in logs, dashboards and uptime checks, and would force every client to
inspect a flag to know whether the call worked. `503 Service Unavailable` is the
honest status for "a dependency this feature needs is unavailable"; the body
still carries the predictable fallback payload the UI needs. `500` is reserved
for genuinely unexpected application bugs by the existing centralised error
handler.

---

## 4. Provider configuration

Both providers are supported with **no new npm dependency**: Node 24 ships a
global `fetch` and `AbortController`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `openai` | `openai` or `gemini`; anything else is treated as unsupported and degrades |
| `OPENAI_API_KEY` | *(empty)* | OpenAI key - backend only |
| `GEMINI_API_KEY` | *(empty)* | Gemini key - backend only |
| `OPENAI_MODEL` | `gpt-4o-mini` | Optional model override |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Optional model override |

`.env.example` (tracked) documents the names with **empty values**; the real
`backend/.env` is git-ignored and is supplied to the container at runtime by
`docker-compose.yml` via `env_file: ./backend/.env` (no build argument, so the
key is not baked into an image layer).

Provider selection is a single lookup table (`PROVIDERS`), so the two
implementations stay symmetric:

| | OpenAI | Gemini |
| --- | --- | --- |
| Endpoint | `POST /v1/chat/completions` | `POST /v1beta/models/{model}:generateContent` |
| Key transport | `Authorization: Bearer <key>` header | `x-goog-api-key: <key>` header |
| Timeout | `AbortController`, 8 s | same |
| Unsupported provider | `AiServiceError('unsupportedProvider')` -> 503 | same |

The key is **never** placed in a URL query string, because URLs are logged by
proxies, browsers, shell history and crash reports.

---

## 5. Prompt design and data minimisation

The system prompt describes the output contract only - two or three sentences,
at most 60 words, actionable, no invented people/dates/budgets/tools, no markdown
or preamble. The user turn is a single line:

```
Task title: <the title the user just typed>
```

That is the **only** application data that leaves the process. Not sent: the
user record, e-mail address, id, JWT, other tasks, project names, cache contents,
environment variables. This is checked by the test suite (the mocked `fetch`
asserts on the exact request body).

Output handling:

* whitespace is collapsed,
* wrapping quotes the model likes to add are stripped,
* the result is capped at 600 characters (a provider can never flood the input),
* an empty or non-string answer is treated as a failure, not as a success.

---

## 6. Failure handling

Every expected failure is converted inside the service into an `AiServiceError`
carrying a **fixed, client-safe message** (the provider's own wording is never
retained), then mapped by the controller to the single 503 fallback body.

| Condition | Detected by | Client sees |
| --- | --- | --- |
| Key not configured | empty/missing env var, checked **before** any network call | 503 fallback |
| Key rejected | provider status 401 / 403 | 503 fallback |
| Quota / rate limited by provider | provider status 429 | 503 fallback |
| Provider error | any other provider status >= 400 | 503 fallback |
| Timeout | `AbortError` / `TimeoutError` from the 8 s AbortController | 503 fallback |
| Network unreachable / DNS / TLS | `fetch` rejection | 503 fallback |
| Malformed or empty answer | JSON parse failure, unexpected shape, empty text | 503 fallback |
| Unsupported `AI_PROVIDER` value | lookup failure | 503 fallback |
| Anything unforeseen thrown by the service | controller `catch` | 503 fallback |
| Broken response body access | outer `catch` -> `next(error)` | existing centralised error handler |

Logging is intentionally minimal: only the error **name** and **code** are
logged (`[ai] description generation failed: AiServiceError (timeout)`), never
the provider message, never request headers, never the key.

The frontend treats the 503 the same way it treats a 429: it shows a short
message and leaves the description field editable. **Task creation is never
blocked by an AI failure** - this is asserted by a test.

---

## 7. Rate limiting

`POST /api/ai/generate-description` costs money per call and the key is shared by
the whole deployment, so an authenticated user must not be able to loop it.

| Limit | Value | Why |
| --- | --- | --- |
| Per task key | 1 request / 60 s | The practical's supplementary requirement: one generation per task per minute |
| Per account | 10 requests / 60 s | A cost ceiling, so a caller cannot spend quota by submitting endless distinct titles |

Design details:

* **Keying without inventing a schema field.** The form creates tasks that have
  no persistent id yet, so the key is derived from the request:
  `task key = sha256(principal + NUL + normalised title)` and
  `user key = sha256(principal)`. Both are hashed: neither the title nor the user
  id is kept in memory. The title is normalised and capped at 200 characters
  before hashing, so a long title cannot build an oversized key.
* **Injectable clock.** `createAiRateLimiter({ now })` accepts a clock, so tests
  advance virtual time instead of waiting 60 real seconds. The full suite runs in
  about 2.6 s.
* **Bounded memory.** The bucket map has `maxSize` (default 5000) and evicts
  empty-then-oldest buckets, so it cannot grow without limit. A test pushes 500
  distinct keys through and asserts the map stays capped instead of taking the
  bound on trust (a `stats()` diagnostics hook exposes the size).
* **Fail-open.** If the limiter itself throws, it logs the error name and calls
  `next()`. A limiter bug must not take down the endpoint; the provider timeouts
  and auth still bound the damage.
* **429 is explicit.** The response carries `Retry-After` in seconds and a
  human-readable message, and the frontend shows it.
* **Invalid input does not consume quota.** A request with no usable title is
  passed straight to the controller, which returns 400.

### Why a separate limiter module

An in-progress, uncommitted `src/middleware/rateLimiter.js` exists in the working
tree (forgot-password, keyed by client IP) but it is **untracked and imports
another untracked module**, so importing it would break a fresh clone and CI. It
is also IP-keyed, which is the wrong axis here (the cost unit is the task, and
the caller is authenticated). The AI limiter is therefore a small self-contained
module used by this endpoint only; no existing limiter was modified or
duplicated in behaviour.

### Honest scope

Counters live in the process memory. They reset on restart and are **not shared
between replicas**, so with N instances the effective limit is N times the
configured value. This is per-instance cost protection, not distributed rate
limiting; a shared store (Redis) would be required for that.

---

## 8. Frontend integration

`frontend/src/services/aiService.js` mirrors the conventions of the existing
`taskService`:

* the same `VITE_API_URL` base (fallback `http://localhost:5000`),
* the same `Authorization: Bearer <token>` header helper,
* the same 401 handling (`removeToken()` + `auth-unauthorized` event), so an
  expired session behaves identically everywhere,
* the browser calls **only** our own backend - the provider host appears nowhere
  in `frontend/src` (enforced by a test).

`frontend/src/pages/Tasks.jsx` gains:

* a real `<button type="button">` ("Generate description") inside the existing
  form actions row,
* a `generating` state that disables the button and shows "Generating..." with
  `aria-busy` and a `role="status"` live region - duplicate requests cannot be
  fired by double-clicking,
* the suggestion written into the **existing** description field (still editable,
  still dismissible by clearing it),
* a visible disclaimer while the current text came from the provider:
  *"AI-generated suggestion - review and edit before using."* (`role="note"`),
* a friendly message on 429 / 503 that leaves the form fully usable.

Nothing is saved automatically: the text reaches the database only through the
normal **Add Task** submission, and the disclaimer state is cleared when the form
is reset, when a new title is entered, or when a task is submitted.

No CSS file was changed: the button reuses the existing `action-row`,
`form-button--ghost` and `muted` classes.

---

## 9. Local setup without a real key

The feature is designed to be demonstrable with **no** provider account:

```bash
# 1. dependencies (already used by the project)
npm install --prefix backend
npm install --prefix frontend

# 2. configure: copy the example and leave the key empty
cp backend/.env.example backend/.env      # Windows: copy backend\.env.example backend\.env
#    AI_PROVIDER=openai
#    OPENAI_API_KEY=          <- empty on purpose

# 3. run
npm run dev            # or: docker compose up --build
```

With an empty key the endpoint returns the 503 fallback and the UI shows
"AI suggestions are temporarily unavailable...". That is the **expected,
correct** behaviour and the easiest way to demonstrate graceful degradation.

To enable real suggestions, put a key in `backend/.env` **only** (never in
`frontend/.env`, never in a `VITE_*` variable, never in a commit):

```
AI_PROVIDER=openai
OPENAI_API_KEY=<your key>
```

The key is read at request time from `process.env`, so a restart of the backend
is enough; no rebuild is required and no key is baked into the image.

---

## 10. Tests

Command (from the repository root):

```bash
node --test "backend/test/aiGeneration.test.js"     # this practical only
npm test                                           # whole backend suite
```

Result of the Practical 13 file, measured in this workspace:

```
ℹ tests 25
ℹ pass 25
ℹ fail 0
ℹ duration_ms 1365.21
exit 0
```

Whole suite, measured in this workspace:

```
ℹ tests 163
ℹ pass 163
ℹ fail 0
ℹ duration_ms 2559.98
exit 0
```

(163 = the 138 tests that existed before this practical + the 25 added here.)

Every provider call is mocked. The suite reads no key, opens no socket and
cannot incur charges, so it runs in CI with no secret configured. The one
credential-shaped string in the fixtures (`sk-test-not-a-real-key-...`) is a
literal placeholder used to prove the key travels in a header; it is not a real
credential.

### What the 25 cases cover

| # | Area | Cases |
| --- | --- | --- |
| 1 | Success, OpenAI | returns sanitised text; key in `Authorization` header; absent from URL and body; only the title leaves the process |
| 2 | Success, Gemini | `x-goog-api-key` header; model path; parsed text |
| 3 | Missing key | fails closed **before** any network call -> 503 fallback |
| 4 | Unsupported provider | -> 503 fallback |
| 5 | Timeout | aborted request -> 503 fallback (virtual clock, no waiting) |
| 6 | Network failure | `fetch` rejection -> 503 fallback |
| 7 | Quota | provider 429 -> 503 fallback |
| 8 | Rejected key | provider 401 / 403 -> 503 fallback |
| 9 | Provider errors | provider 400 / 5xx -> 503 fallback |
| 10 | Malformed output | invalid JSON, empty text, non-string shape -> 503 fallback |
| 11 | Input validation | missing / non-string / over-long title -> 400; over-long answer capped |
| 12 | Response contract | 200 body shape, 503 body shape, unexpected exception degraded (no stack, no provider text) |
| 13 | Rate limit | 1/min per task; 429 + `Retry-After`; scoped by title and by user; window re-opens; invalid titles consume nothing; per-account ceiling; bound under 500-key churn |
| 14 | Routing over real HTTP | `/api/ai/generate-description` resolves; 401 without a valid token; 404 for other paths in the mount; authenticated run hits 429 then recovers |
| 15 | No regression | task creation and listing still work while the provider is unavailable |
| 16 | Frontend privacy guard | no provider endpoint and no provider key variable anywhere in `frontend/src` |

The project has no frontend test runner (verified: `frontend/package.json` has
lint and build only), so the "the browser must never call the provider" rule is
enforced by a static guard test rather than added as an unverified claim or by
installing a test framework this practical does not need.

### Pre-existing flaky test (not caused by this practical)

`backend/test/jobService.test.js:223` is an untracked test from earlier work and
it is flaky (a `strictEqual` between two ids). During this practical the full
suite passed 163/163 twice and failed once on exactly that assertion. It was
**not** modified, skipped or weakened; touching it would be outside this
practical's scope and would hide someone else's flake.

### Integration suite

`npm run test:integration` still refuses to run: `TestDatabaseNotApprovedError`
(`RUN_INTEGRATION_TESTS=1` opt-in is not set), 20 tests refused. That guard is
intentional and was not bypassed.

---

## 11. Live verification through the real server

The automated tests mount the router themselves, so the `server.js` mount was
also verified live, against the **real application** started on a spare port
(`PORT=5099`) with the real `backend/.env` and a locally reachable MongoDB.
No AI key was configured for this run, no task was created, and no secret or
token appears in the output below.

```
POST /api/ai/generate-description  (no token)
  status: 401
  body:   {"error":"Access token required"}

POST /api/ai/generate-description  (valid token; NO AI key configured)
  status: 503
  body:   {"description":"","fallback":true,"message":"AI suggestions are temporarily unavailable. You can enter the description manually."}

POST /api/ai/generate-description  (same title again, same user)
  status: 429  Retry-After: 60
  body:   {"error":"An AI suggestion for this task was already generated. Try again in about a minute."}

GET /tasks  (no token - existing endpoint unchanged)
  status: 401
  body:   {"error":"Access token required"}

POST /api/ai/generate-description  (valid token, empty title)
  status: 400
  body:   {"error":"Title is required"}
```

Assertions printed by the check script: `PASS` for all six:
no token -> 401, no key -> 503 with `fallback:true`, same task key -> 429,
`GET /tasks` unchanged, empty title -> 400, and no JWT secret present in any
response body. Script exit code: `0`.

This proves, end to end and with the production wiring: the documented path
exists on the real server, authentication and the limiter run in the intended
order, provider absence degrades gracefully instead of crashing, and existing
endpoints are unaffected.

### Docker-container verification: pending

`docker compose ps` could not run at verification time because the Docker daemon
was unreachable on this machine
(`npipe:////./pipe/dockerDesktopLinuxEngine: The system cannot find the file
specified`). The stack itself was therefore **not** re-verified for this
practical and is recorded as pending rather than claimed. No destructive Docker
command was run and the MongoDB data volume was not touched.

**No live AI call was made**: no provider key is configured in this workspace, so
the only real provider-facing outcome observed was the graceful 503 fallback. A
"screenshot of a real AI suggestion" can only be produced after adding a key.

---

## 12. Graceful-failure demonstration

Because failure is the interesting part of an AI integration, the degraded path
is demonstrable without any key:

1. Keep `OPENAI_API_KEY=` empty in `backend/.env` and start the app.
2. Log in, type a title, press **Generate description**.
3. Expected: the button shows "Generating..." briefly, then the form shows
   *"AI suggestions are temporarily unavailable. You can enter the description
   manually."*, the description field stays editable, and **Add Task still
   works**.
4. Press the button twice in a row: the second request returns 429 and the UI
   reports that a suggestion was already generated, without breaking the form.
5. Network-level failure can be shown the same way by setting an unreachable
   `OPENAI_MODEL`-independent condition (e.g. disabling the network), because the
   8 s timeout and the transport error both map to the same fallback.

The same behaviour at the API level is the `503` / `429` output quoted in
section 11.

---

## 13. Responsible AI and privacy

| Concern | Measure in this implementation |
| --- | --- |
| Secret leakage | Key read from the backend environment only; never in a `VITE_*` variable, a URL, a log line or a response; `.env` is git-ignored, `.env.example` holds empty placeholders |
| Data minimisation | Only the task title is sent; no identity, no token, no other task or project data |
| Third-party retention | The provider's own data policy applies to the title; the prompt instructs the model to invent nothing, and the app stores only the text the user accepts |
| Output trust | Output is a suggestion in an editable field with a visible disclaimer; it is never auto-saved, never auto-submitted, and never used to trigger an action |
| Hallucination | Prompt constrained to 2-3 sentences with no invented people, dates, budgets or tools; length capped; the user must review |
| Account abuse / cost | Authenticated endpoint, per-task 1/min, per-account 10/min, 8 s timeout, `max_tokens`/`maxOutputTokens` cap of 160 |
| Error disclosure | Fixed messages only; provider text, status detail and stacks never reach the client; logs carry the error name/code only |
| Availability | Missing key, provider outage or malformed answer degrade to 503 with a fallback body; task management is unaffected |
| Fairness / bias | No user attribute is sent, so the model cannot condition the description on the user's identity |
| Transparency | The UI labels the text as AI-generated; this document records exactly what is sent and what is not |
| Compliance with the provider's terms | Content is user-authored task titles; the feature is disclosed in the UI and documented here |

Residual privacy risk, stated plainly: the title is user content and it *does*
leave our infrastructure to a third-party API. A deployment that cannot accept
that (for example one handling regulated data) should leave the key unset - the
feature then simply reports itself unavailable, which is a supported state.

---

## 14. Known limitations

1. **Process-local rate limiting.** Counters are per Node process; a restart
   resets them and multiple replicas get their own. Distributed limiting needs a
   shared store.
2. **Task identity is derived, not stored.** Because the form's task does not
   exist yet, the limit is keyed by a hash of (user, normalised title). Two users
   with the same title are independent; one user who edits a title by one
   character gets a new key. That is the correct trade-off for a pre-creation
   form, but it is not the same as a database-backed per-task counter.
3. **No streaming.** The description arrives as one response; the UI shows a
   single "Generating..." state.
4. **No retry/backoff against the provider.** A failure is reported once; the
   user can retry after the local window. Retrying internally would multiply
   latency and cost.
5. **Provider parity is by contract, not by benchmark.** Both providers are
   tested with the same mocked contract; output quality differences between
   models were not evaluated.
6. **No live provider call was made here**, so the exact wording produced by the
   model in this environment is unverified (see section 11).
7. **Docker container re-verification is pending** because the Docker daemon was
   unavailable during this practical.
8. **Frontend behaviour is not covered by an automated UI test** (the project has
   no frontend test runner); the privacy rule is enforced statically and the
   component was verified by lint, a production build and the API-level contract.
9. **Rate limiting is not applied to any other endpoint**, by design: it is
   isolated to the AI endpoint.

---

## 15. Screenshot / evidence placeholders

The screenshots below have **not** been captured in this workspace (Docker was
down and no provider key is configured). They are listed so they can be added
when a demo environment is available - no image is invented here.

| # | What to capture | How to produce it | Status |
| --- | --- | --- | --- |
| 1 | New Task form with the **Generate description** button | `npm run dev`, log in, open the task form | Not captured |
| 2 | Loading state: "Generating..." while the request is in flight | throttle the network in devtools, press the button | Not captured |
| 3 | Successful suggestion in the description field with the disclaimer | requires a real provider key in `backend/.env` | Not captured (no key) |
| 4 | Graceful fallback message with an empty key | leave `OPENAI_API_KEY=` empty, press the button | Not captured |
| 5 | 429 after pressing the button twice within a minute | press twice | Not captured |
| 6 | Browser devtools Network tab showing the request goes to our own backend only, with no provider key in the request | open devtools, press the button | Not captured |

Text evidence that *was* produced and can be pasted into the report: the test
counts (section 10), the live API output (section 11) and the commit list
(section 20 and `docs/practical-13-commit-audit.md`).

---

## 16. Viva-ready questions

**1. Where is the API key stored and why not in the frontend?**
In the backend environment (`backend/.env`, git-ignored) and read by
`aiDescriptionService` at request time. Vite inlines `VITE_*` variables into the
public bundle, so any such variable would publish the key; the browser therefore
never sees it, and a test asserts no provider key variable exists in
`frontend/src`.

**2. How do you prove the key is not in the request URL?**
The mocked `fetch` assertions check the URL, the headers and the serialised body:
the key appears only in `Authorization` (OpenAI) or `x-goog-api-key` (Gemini),
never in the URL or the body. URLs are logged by proxies and browsers, headers
are not.

**3. What exactly is sent to the provider?**
The normalised task title (max 200 characters) plus a fixed system prompt. No
user record, token, e-mail, project, other task or configuration.

**4. What happens when the provider fails?**
Every provider-side outcome (missing key, 401/403, 429, other 4xx/5xx, timeout,
network error, malformed or empty output, unsupported provider, unexpected
exception) is mapped to `503` with `{ description: "", fallback: true, message }`.
The user is told to write the description manually, and task creation is
unaffected - there is a test for that.

**5. Why not return 200 with an error field?**
Because the call did not succeed. `503` keeps the failure visible to monitoring
and is honest to clients, while the body stays predictable for the UI. `500` is
kept for genuine application bugs.

**6. How is the timeout implemented and verified?**
`AbortController` + `setTimeout` (8 s), cleared in `finally`. The test injects a
`fetch` that rejects with an `AbortError` (and a controllable timeout), so the
timeout path is exercised in milliseconds, not by waiting 8 s.

**7. How does the rate limit work without waiting a minute in tests?**
`createAiRateLimiter({ now })` takes an injectable clock. Tests advance virtual
time past the 60 s window, so the suite runs in ~2.6 s while the production
window is real.

**8. Why is the memory footprint bounded?**
Its `Map` has `maxSize` (5000) and prunes empty buckets then evicts oldest keys.
A test pushes 500 distinct keys and asserts the size stays capped.

**9. Why not reuse the existing rate limiter?**
It is untracked (would break a fresh clone/CI), it keys by IP (wrong axis for an
authenticated, per-task cost), and it serves a different endpoint. Reusing it
would couple this feature to unfinished work; instead a small isolated module is
used for this endpoint only.

**10. Is the AI output saved automatically?**
No. It is written into the editable description field with the disclaimer
"AI-generated suggestion - review and edit before using." and only reaches the
database when the user submits the form.

**11. How do you prevent a giant provider response from breaking the form?**
The service collapses whitespace, strips wrapping quotes and caps the text at 600
characters before it is returned; empty or non-string output is treated as a
failure.

**12. What would you change for production at scale?**
Move the counters to a shared store (Redis), add a per-user daily budget, add
observability for provider latency/error rate, consider caching identical
(user, title) results for a short TTL, and add a UI test for the button flow.

---

## 17. Reflection - errors encountered and how they were resolved

1. **No global `/api` prefix.** The obvious `app.use('/api', aiRoutes)` would have
   produced `/api/generate-description`, not the required path. Inspecting
   `server.js` showed auth at `/` and tasks at `/tasks`; mounting the router at
   `/api/ai` fixed the path without touching existing routes, and the route test
   asserts the exact path.
2. **Unusable existing limiter.** The first plan was to reuse
   `src/middleware/rateLimiter.js`. It turned out to be untracked and to import
   another untracked module, so committing a dependency on it would break a
   fresh clone and CI. Worse, it keys by IP, not by task. The resolution was a
   small self-contained limiter for this endpoint.
3. **No task id to key the limit on.** The form's task does not exist yet; adding
   a database field for a transient form value would be schema noise. Keying by
   `sha256(user + title)` gives the required "once per minute per task" semantic
   without inventing a field, and keeps the title out of memory as plaintext.
4. **A commit message that contained double quotes** was split by the shell and
   `git commit` failed with "did not match any file(s) known to git". Nothing was
   committed and the index was intact; the fix was to pass the message with
   `git commit -F <file>` so quoting can never interfere again.
5. **Pre-existing work inside files that the practical must touch.**
   `backend/server.js` and `backend/.env.example` already carried uncommitted
   changes (job work and test/env additions). Committing the files wholesale
   would have stolen that work into this practical's commit. They were staged
   partially - only the AI lines were put in the index - and the unstaged diff was
   re-checked afterwards to confirm the pre-existing changes were byte-for-byte
   untouched.
6. **A flaky test from earlier work** (`backend/test/jobService.test.js:223`)
   failed once during full-suite runs. It is untracked and unrelated; it was left
   alone and is documented rather than silenced.
7. **Windows exit-code artifact in the live check.** The script reported the
   correct assertions but crashed during process teardown in libuv
   (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`) because of lingering
   keep-alive sockets. Sending `Connection: close` and using `process.exitCode`
   instead of `process.exit()` produced a clean `exit 0`.
8. **Docker daemon unavailable** at final verification, so container evidence
   could not be produced. Rather than claim it, the live check was run against
   the real server process, and the container step is recorded as pending.

What this practical changed in my understanding: the hard part of an AI feature
is not the prompt, it is the boundary - what leaves the process, what is trusted
when it comes back, what the user is told when it fails, and how much it can cost
before anyone notices.

---

## 18. Commands used for verification

```bash
# tests
node --test "backend/test/aiGeneration.test.js"     # 25/25, exit 0
npm test                                           # 163/163, exit 0
npm run test:integration                            # refused by the DB safety guard (expected)

# frontend
npm run frontend:lint                              # exit 0
npm run frontend:build                             # exit 0, built in 511 ms

# live check against the real server (no AI key configured)
# PORT=5099 node backend/server.js  +  a scripted client
#   401 / 503 fallback / 429 + Retry-After / 401 on /tasks / 400 on empty title  -> exit 0

# git hygiene used before each commit
git diff --cached --check
git diff --cached --stat
git diff --numstat                                 # confirms pre-existing work untouched
```

---

## 19. Git safety rules observed

* No `reset --hard`, `clean`, `stash`, `restore`, `checkout`, `switch`, `amend`,
  merge, rebase or force-push.
* Nothing was staged with `git add .` / `git add -A`: every commit lists its
  files explicitly.
* Pre-existing modified and untracked work (job processing, security, e-mail,
  rate limiter, debug controller, tests) was left exactly as found, including
  `backend/package.json` with its uncommitted test scripts.
* No `.env`, credential, `node_modules`, `dist` or test artifact was committed.
* The database integration guard was never bypassed and no assertion was weakened.
* Commits are local only; nothing was pushed.

See `docs/practical-13-commit-audit.md` for the per-commit inventory.
