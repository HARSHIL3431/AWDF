# Practical 13 - Commit and Safety Audit

Audit of the work done for Practical 13 (secure AI task description generator):
what was committed, what was deliberately **not** committed, which results were
actually observed, and which items remain pending.

Audit date: **2026-10-26**
Branch: `feature/practical-10-events`
Starting commit: **`59ca2a4`** (`docs: add Practical 12 commit audit report`)
Remote tracking at start: `origin/feature/practical-10-events`, 0 ahead / 0 behind.

---

## 1. Commits created (local only)

All six commits are local. **Nothing was pushed, merged, rebased, amended or
force-pushed.**

| # | Commit | Message | Files | Lines |
| --- | --- | --- | --- | --- |
| 1 | `ac64602` | `feat: add secure AI task description endpoint` | 6 | +552 |
| 2 | `afc1955` | `feat: add AI description suggestions to task form` | 2 | +124 |
| 3 | `db7ef5d` | `test: cover AI generation and fallback behavior` | 1 | +774 |
| 4 | `4ea62e1` | `docs: document Practical 13 AI integration` | 1 | +711 |
| 5 | `9a25920` | `docs: add Practical 13 commit audit report` | 1 | +235 |
| 6 | *(this commit)* | `docs: correct Practical 13 live-provider findings` | 2 | see below |

Commit 6 corrects commits 4 and 5 after the live-run logs were re-read: the
provider had actually been reached and answered HTTP 429 (quota), which the
earlier text wrongly described as "no provider key configured". The correction is
recorded as its own commit instead of amending history, so the audit trail shows
both the mistake and the fix. See section 6.

### Commit 1 - `ac64602` backend

| File | Change |
| --- | --- |
| `backend/src/services/aiDescriptionService.js` | +245 (new) |
| `backend/src/middleware/aiRateLimiter.js` | +162 (new) |
| `backend/src/controllers/aiController.js` | +90 (new) |
| `backend/src/routes/aiRoutes.js` | +39 (new) |
| `backend/server.js` | +6 (**partial staging**: import + mount only) |
| `backend/.env.example` | +10 (**partial staging**: AI block only) |

### Commit 2 - `afc1955` frontend

| File | Change |
| --- | --- |
| `frontend/src/pages/Tasks.jsx` | +67 |
| `frontend/src/services/aiService.js` | +57 (new) |

### Commit 3 - `db7ef5d` tests

| File | Change |
| --- | --- |
| `backend/test/aiGeneration.test.js` | +774 (new, 25 cases, all provider calls mocked) |

### Commit 4 - `4ea62e1` documentation

| File | Change |
| --- | --- |
| `docs/practical-13-ai-integration.md` | +711 (new) |

### Commit 5 - audit report

| File | Change |
| --- | --- |
| `docs/practical-13-commit-audit.md` | +235 (new) |

### Commit 6 - correction

| File | Change |
| --- | --- |
| `docs/practical-13-ai-integration.md` | corrected live-verification, precedence, limitations, screenshots, reflection |
| `docs/practical-13-commit-audit.md` | corrected live-provider findings and secret/key notes |

Commit 6 changes documentation only - no code, test or configuration file moved.

No commit deletes or renames a file. No existing test was modified, skipped or
weakened. `backend/package.json` was **not** committed even though it already
carried uncommitted `test` / `test:integration` scripts before this practical -
those scripts are pre-existing local work, not part of the AI feature.

---

## 2. Pre-existing work preserved

At the start of the practical the working tree contained 9 modified tracked files
and 18 untracked paths that were **not** mine. They are listed here so that any
future diff can be compared against this baseline.

### Modified tracked files (all still uncommitted, byte-for-byte unchanged)

| File | Baseline numstat (added/deleted) | Final numstat |
| --- | --- | --- |
| `README.md` | 159 / 1 | **159 / 1** |
| `backend/.env.example` | 5 / 1 | **5 / 1** |
| `backend/package.json` | 3 / 1 | **3 / 1** |
| `backend/server.js` | 76 / 1 | **76 / 1** |
| `backend/src/controllers/authController.js` | 17 / 7 | **17 / 7** |
| `backend/src/middleware/errorHandler.js` | 11 / 4 | **11 / 4** |
| `backend/src/middleware/logger.js` | 33 / 5 | **33 / 5** |
| `backend/src/routes/authRoutes.js` | 3 / 1 | **3 / 1** |
| `backend/src/services/emailService.js` | 23 / 4 | **23 / 4** |

### Untracked paths (18, still untracked and untouched)

`backend/src/config/jobConfig.js`, `backend/src/controllers/debugController.js`,
`backend/src/middleware/rateLimiter.js`, `backend/src/models/jobModel.js`,
`backend/src/security/`, `backend/src/services/jobService.js`,
`backend/src/workers/`, `backend/test/controller.test.js`,
`backend/test/dbGuard.test.js`, `backend/test/emailWorker.test.js`,
`backend/test/encryption.test.js`, `backend/test/helpers/`,
`backend/test/integration/`, `backend/test/jobModel.test.js`,
`backend/test/jobService.test.js`, `backend/test/logging.test.js`,
`backend/test/rateLimiter.test.js`, `backend/test/regression.test.js`.

### Why partial staging was necessary

`backend/server.js` and `backend/.env.example` are the two files where the AI
work and pre-existing work overlap. Committing either file wholesale would have
swept unrelated (job-processing / test-environment) changes into this practical's
history.

Only the AI lines were placed in the index:

| File | Staged (AI only) | Left unstaged (pre-existing) |
| --- | --- | --- |
| `backend/server.js` | +6 (one import, one mount block) | 76 / 1 |
| `backend/.env.example` | +10 (AI block) | 5 / 1 |

Verification after each commit:

* `git diff --numstat` (unstaged) returned exactly the baseline numbers above,
* `git diff -U0` for those two files contained no AI line,
* `git diff --cached` was empty at the end,
* `git stash list` was empty throughout - no stash was ever created.

---

## 3. Results actually observed

| Check | Command | Result |
| --- | --- | --- |
| Practical 13 tests | `node --test "backend/test/aiGeneration.test.js"` | **25 / 25 pass**, 0 fail, exit 0, 1.37 s |
| Whole backend suite | `npm test` | **163 / 163 pass**, 0 fail, exit 0, 2.56 s |
| Frontend lint | `npm run frontend:lint` | exit 0, no warnings |
| Frontend build | `npm run frontend:build` | exit 0, built in 511 ms (`index-B9kC4DV5.js`) |
| Live API check (real server; real provider round-trip) | `PORT=5099 node backend/server.js` + scripted client | 401 / **503 fallback caused by a real provider HTTP 429 (quota)** / 429 + `Retry-After` / 401 on `/tasks` / 400 on empty title - 6/6 assertions `PASS`, exit 0 |
| DB integration suite | `npm run test:integration` | **refused** by the safety guard (`TestDatabaseNotApprovedError`, `RUN_INTEGRATION_TESTS=1` not set), 20 tests refused, exit 1 |
| Staged whitespace / conflict check | `git diff --cached --check` | exit 0 for every commit |
| Staged secret scan | regex over `git diff --cached` | clean for every commit |

Baseline before any edit, recorded for comparison: `npm test` 138/138 exit 0,
lint exit 0, build exit 0. The 25 new tests account for 163 - 138.

### What the live run actually did

`backend/.env` has no provider key, but this Windows account has
`OPENAI_API_KEY` set as a **user environment variable** (164 characters; the
value was never printed, copied or committed). The server process inherited it,
so the one authenticated request really did leave the machine and OpenAI replied
**HTTP 429 (quota)** in 394 ms. The service logged
`[ai] description generation failed: AiServiceError (quota)` and returned the 503
fallback - a genuine provider-failure path, not a simulated one.

Consequences, stated precisely:

* **One** real provider request was made, by accident of environment inheritance.
  No further provider calls were made after the logs were understood.
* **No AI text was generated** and no successful generation is claimed.
* A rejected request bills no tokens, so cost is effectively **zero**, but it is
  not accurate to say "the provider was never called".
* The key is **outside the repository** (OS environment), so nothing secret was
  staged or committed; `.env` and the docs contain no key value.
* Commits 4 and 5 were already written when this was discovered, so commit 6
  corrects them rather than amending published history.

### Pre-existing flake, not caused by this practical

`backend/test/jobService.test.js:223` (untracked, from earlier work) failed once
during a full-suite run (`strictEqual` between two ids) and passed on the runs
before and after. It was left untouched: no edit, no skip, no weakened assertion.
The suite is therefore reported as 163/163 on the passing runs **and** the flake
is disclosed here rather than hidden.

---

## 4. Secret and configuration audit

| Rule | Status |
| --- | --- |
| No provider key in the repository | Confirmed - regex scan of every staged diff (`sk-…`, `AIza…`, `ghp_…`, private-key headers) found nothing |
| Where the key actually lives | Not in `backend/.env` (it contains no AI variables). This machine has `OPENAI_API_KEY` as a Windows **user environment variable**, outside the repository. It was never printed, staged, copied into a file or logged |
| Environment precedence | Shell/OS variables win over `backend/.env` (the loader does not override existing values). Documented in the integration doc so the "missing key" demo is not mistaken for a broken feature |
| `.env` not committed | Confirmed - `backend/.env` is git-ignored; only `backend/.env.example` is tracked, with **empty** values |
| No key in a `VITE_*` variable | Confirmed - `frontend/src` contains no provider key reference (enforced by a test) |
| No key in URL / logs / responses | Confirmed - key is sent in a header; the controller logs only error name/code; the live check asserted no JWT secret appears in any body |
| No key in Docker build args or image layers | Confirmed - no compose or Dockerfile change; the key is supplied at runtime by `env_file: ./backend/.env` |
| No key in test fixtures | Only a literal placeholder, `sk-test-not-a-real-key-...`, in `backend/test/aiGeneration.test.js`, used to prove header transport. It is not a credential and cannot authenticate anywhere |
| No credentials printed in this audit | Confirmed - no `.env` content, token or key value is quoted anywhere in the documentation |

---

## 5. Docker and database safety

* No `docker compose down`, no `down -v`, no volume deletion, no image pruning,
  no `docker system prune`. The MongoDB named volume was not touched.
* The only Docker command attempted was a read-only `docker compose ps`, which
  failed because the Docker daemon was unreachable
  (`npipe:////./pipe/dockerDesktopLinuxEngine: The system cannot find the file
  specified`). Docker Desktop was not stopped or restarted by this work.
* Consequence: **container-level verification of Practical 13 is pending.** The
  live check was therefore run against the real `server.js` process on a spare
  port (`5099`, freed afterwards) with a locally reachable MongoDB. No task was
  created and no data was modified by that check.
* The database integration suite's safety guard was **not** bypassed: it refused
  to run because no isolated test database is approved (`RUN_INTEGRATION_TESTS=1`
  opt-in absent). No `MONGO_URI` was edited and no real database was targeted.

---

## 6. Mocked versus real AI calls

| Item | Reality |
| --- | --- |
| Automated tests | **100% mocked.** No key read, no socket opened, no cost incurred, so CI needs no secret |
| Live server check | **Real HTTP** through the real router, auth and limiter; the provider was reached once and answered **429 (quota)**, translated to the 503 fallback |
| Real provider request | **One, unintentionally**, because an OS-level `OPENAI_API_KEY` was inherited by the process. It was rejected before any generation |
| Successful AI output | **None observed.** No suggestion text exists to show |
| Cost incurred | Effectively **zero** (a rejected request bills no tokens), but the call was real |

---

## 7. Pending items

| Item | Reason | What is needed |
| --- | --- | --- |
| Docker container verification of the endpoint | Docker daemon unreachable at verification time | Start Docker Desktop, `docker compose up --build`, then repeat the five requests from the live check against port 5000 |
| Screenshot of a successful AI suggestion | The inherited provider key is quota-exhausted (HTTP 429) | Use a key with remaining quota, press **Generate description**, capture the form with the disclaimer |
| Remaining screenshot placeholders | No browser capture was made in this environment | See section 15 of `docs/practical-13-ai-integration.md` |
| Database integration suite | Refused by its own safety guard | An explicitly approved isolated test database plus `RUN_INTEGRATION_TESTS=1` |
| Pre-existing flaky job test | Untracked work outside this practical's scope | Its owner should fix `jobService.test.js:223` |

None of these block the feature: the implementation, its tests, the live
degraded-path verification and the documentation are complete.

---

## 8. Push status

Local branch `feature/practical-10-events` is **ahead of
`origin/feature/practical-10-events` by 6 commits and was not pushed**.

The prompt for this practical explicitly forbids pushing, merging, rebasing,
amending and force-pushing, so the commits were left local. Pushing would be a
separate, explicitly authorised action.

---

## 9. Final state checklist

* [x] 6 commits created, all with descriptive messages; the documentation
      correction is a separate commit, not an amend
* [x] No push, merge, rebase, amend, force-push
* [x] No `reset --hard`, `clean`, `stash`, `restore`, `checkout`, `switch`
* [x] No `git add .` / `git add -A`; every path listed explicitly
* [x] 9 pre-existing modified files unchanged (numstat identical to baseline)
* [x] 18 pre-existing untracked paths unchanged
* [x] `backend/package.json` left unstaged and uncommitted
* [x] No `.env`, credential, `node_modules`, `dist` or test artifact committed
* [x] 25/25 new tests pass; full suite 163/163 on passing runs; lint and build pass
* [x] Live degraded-path verification passed against the real server, including a
      real provider 429 translated to the fallback
* [x] Documentation contains no fabricated screenshot, test result or live AI success
* [x] Docker/DB safety guard respected; volume untouched
* [ ] Docker container verification (pending - daemon unavailable)
* [ ] Screenshot of a real AI suggestion (pending - provider key quota-exhausted)
