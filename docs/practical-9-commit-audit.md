# Practical 9 — Smart Git Commit Audit

**Task:** Organize completed, uncommitted work into small, logical, verified commits before Practical 10.
**Repository:** `C:\Users\Admin\Desktop\sem 5\webdev` · branch `main`
**Date:** 2026-10-25
**Authorization:** Local commits for verified, safe changes only — **no push, no amend, no history rewrite.**

---

## 1. Initial repository state

| Item | Value |
|---|---|
| Repository root | `C:\Users\Admin\Desktop\sem 5\webdev` (`.git` at root; `backend/` and `frontend/` are subdirectories) |
| Branch | `main` (tracking `origin/main`, **ahead 1** at start) |
| Initial HEAD | `3b0ce8163cc9480a22f382105114010bb355c477` — *feat: add in-memory task caching and query optimization* |
| Staged changes | **None** (`git diff --cached` empty) |
| Initial working tree | 10 modified tracked files, 9 untracked paths (enumerated below) |
| Latest Practical 9 records | `docs/practical-9.md` (practical report), `docs/practical-9-audit.md` (audit report — untracked at start) |

Initial `git status --short`:

```
 M README.md
 M backend/.env.example
 M backend/package.json
 M backend/server.js
 M backend/src/controllers/authController.js
 M backend/src/middleware/errorHandler.js
 M backend/src/middleware/logger.js
 M backend/src/routes/authRoutes.js
 M backend/src/services/emailService.js
 M docs/practical-9.md
?? backend/src/config/jobConfig.js
?? backend/src/controllers/debugController.js
?? backend/src/middleware/rateLimiter.js
?? backend/src/models/jobModel.js
?? backend/src/security/
?? backend/src/services/jobService.js
?? backend/src/workers/
?? backend/test/
?? docs/practical-9-audit.md
```

Verification of prior claims: the Practical 9 **implementation** (cache service, controller/middleware caching, invalidation, `/debug/cache-stats`, `node-cache` dependency, `docs/practical-9.md`) is indeed fully committed at `3b0ce81` — confirmed by `git show 3b0ce81 --stat` (9 files, all cache-related). No duplicate implementation commit was created.

---

## 2. Change classification

### Already committed (verified, no action)
- Entire Practical 9 implementation: `backend/src/services/cacheService.js`, `backend/src/controllers/taskController.js` (cache-aside + invalidation), `backend/src/middleware/validateTaskId.js`, `backend/server.js` cache-stats route, `node-cache` in `backend/package.json` + lockfile, `backend/test_practical9.js`, `docs/practical-9.md` (original content), and all Practical 9 references in `README.md` (API table, doc links, test-script line — confirmed present in `HEAD:README.md`).

### Practical 9 changes committed by this task
| File | Type | Commit |
|---|---|---|
| `backend/test/cache.test.js` | New — 14 automated cache-behavior tests (added during the Practical 9 audit) | A |
| `docs/practical-9-audit.md` | New — final Practical 9 audit report (compliance matrix, remediation log, benchmark) | B |
| `docs/practical-9.md` | Modified — appended "Independent Verification" section only (9 lines) | C |
| `docs/practical-9-commit-audit.md` | New — this report | D |

### Unrelated user work — preserved untouched (NOT committed)
- **Modified:** `README.md` (+159/−1: job-processing, rate-limiting, encryption-key, and test-suite documentation), `backend/.env.example` (+ job encryption/test-DB entries), `backend/package.json` (+ `test`/`test:integration` scripts), `backend/server.js` (+76: worker startup/shutdown), `backend/src/controllers/authController.js`, `backend/src/middleware/errorHandler.js`, `backend/src/middleware/logger.js`, `backend/src/routes/authRoutes.js`, `backend/src/services/emailService.js`.
- **Untracked:** `backend/src/config/jobConfig.js`, `backend/src/controllers/debugController.js`, `backend/src/middleware/rateLimiter.js`, `backend/src/models/jobModel.js`, `backend/src/security/`, `backend/src/services/jobService.js`, `backend/src/workers/`, and the test-suite files `backend/test/{regression,rateLimiter,logging,jobService,jobModel,emailWorker,encryption,dbGuard,controller}.test.js`, `backend/test/helpers/`, `backend/test/integration/`.

**Judgment calls (documented, not changed):**
1. `backend/package.json`'s only uncommitted change adds the `test`/`test:integration` scripts. It is shared infrastructure for the whole uncommitted test suite (regression/job/rate-limiter tests), not specific to Practical 9, and the cache tests do not require it (`node --test "test/cache.test.js"` runs standalone). Partial-staging a single hunk line from this file was judged unnecessary and riskier than leaving it with its own work → **left uncommitted**.
2. `backend/test/regression.test.js` contains one pre-existing cache unit test but is fundamentally the user's broader regression suite → **left uncommitted**; Practical 9 cache coverage is fully carried by the dedicated new file.
3. `README.md`'s uncommitted diff contains **no** Practical 9 content (verified hunk-by-hunk; all P9 references already exist in `HEAD`) → **left uncommitted**.

### Sensitive or excluded files (never staged)
| Path | Reason |
|---|---|
| `.env`, `backend/.env` | Real credentials (`MONGO_URI`, `JWT_SECRET`, SMTP, encryption key) — ignored by `.gitignore:2` and `backend/.gitignore:2` |
| `GitHub token.txt` | Credential file — ignored by `.gitignore` |
| `practical files/` | Source material — ignored by `.gitignore` |
| `node_modules/` (root, backend, frontend) | Dependencies — ignored |

Secret scan performed on all three committed Practical 9 files (patterns: connection strings, JWT-looking blobs, `MONGO_URI=`/`JWT_SECRET=` values, email addresses) → **no matches**.

### Generated artifacts
`frontend/dist/` (tracked, unchanged), `node_modules/` (ignored). Nothing generated was staged; frontend build was deliberately not run to avoid rewriting tracked `dist/` files.

---

## 3. Commit plan

Order chosen so each commit is independently understandable and later commits only reference already-existing files:

1. **A — tests first** (`test: cover task caching and invalidation behavior`): the executable evidence for Practical 9; depends on nothing but committed source files.
2. **B — audit report** (`docs: add Practical 9 implementation audit`): standalone deliverable documenting the verification.
3. **C — practical documentation** (`docs: document Practical 9 caching verification`): a 9-line pointer/verification section in the existing practical doc; placed after A and B so the paths it links (`backend/test/cache.test.js`, `docs/practical-9-audit.md`) already exist in history.
4. **D — this commit audit report** (`docs: add Practical 9 commit audit report`).

Not done deliberately: no implementation commit (already at `3b0ce81`), no commit for any job-processing/rate-limiter/security/frontend work, no `.gitignore` edits, no file deletions, no `git add .`/`-A`.

---

## 4. Commits created

### Commit A
| | |
|---|---|
| Hash | **`d6dff4a`** |
| Message | `test: cover task caching and invalidation behavior` (body explains the 14 cases and the stubbing approach) |
| Files | `backend/test/cache.test.js` (new, 354 lines) |
| Purpose | Executable Practical 9 coverage: list miss/hit with DB-query counting, empty-result caching, database-error non-caching, per-id key isolation, fresh-vs-cached response-shape parity (list and single task), POST/PUT/DELETE invalidation, failed-write preservation (400/404 contracts), write-path DB validation, statistics math + zero-request safety + no-reset-on-invalidation, TTL expiry, and the `authenticateToken` guard on the stats endpoint |
| Validation | Content reviewed in full pre-staging; `git diff --cached --check` clean; only committed source files imported; `node --test test/cache.test.js` → **14/14 pass** after the commit |

### Commit B
| | |
|---|---|
| Hash | **`d18297f`** |
| Message | `docs: add Practical 9 implementation audit` |
| Files | `docs/practical-9-audit.md` (new, 358 lines) |
| Purpose | Durable requirement-by-requirement audit: compliance matrix (45 PASS / 8 N/A / 1 BLOCKED / 0 FAIL), initial baseline, remediation log, security & non-regression review, actual test results, independently measured benchmark |
| Validation | All 12 required sections present in staged diff; secret scan clean; `git diff --cached --check` clean |

### Commit C
| | |
|---|---|
| Hash | **`244bac0`** |
| Message | `docs: document Practical 9 caching verification` |
| Files | `docs/practical-9.md` (+9 lines, appended section only — original content byte-identical) |
| Purpose | Points readers of the practical report to the audit report, the cache test suite, and the independently measured benchmark |
| Validation | Staged diff inspected in full (append-only, `@@ -77,3 +77,13 @@`); trailing blank line at EOF fixed and `git diff --cached --check` re-run clean before committing |

### Commit D
| | |
|---|---|
| Hash | This report's commit — exact hash via `git log -1 -- docs/practical-9-commit-audit.md` (message `docs: add Practical 9 commit audit report`) |
| Files | `docs/practical-9-commit-audit.md` (this file) |
| Purpose | Final Git audit record for the commit operation |
| Validation | Written from verified command output; no secrets included |

---

## 5. Test results (actual commands and output)

| # | Command | Result | Classification |
|---|---|---|---|
| 1 | `cd backend && npm test` (baseline, before any commit) | **123 pass / 0 fail / 0 skipped** (109 pre-existing + 14 cache tests) | Successful |
| 2 | `cd backend && node --test "test/cache.test.js"` (after Commit A) | **14 pass / 0 fail** | Successful |
| 3 | `cd backend && npm test` (after all commits) | **123 pass / 0 fail / 0 skipped**, duration ≈ 1.94 s | Successful |
| 4 | `cd backend && npm run test:integration` | Refused by `test/helpers/dbGuard.js` — `RUN_INTEGRATION_TESTS=1` / approved `TEST_MONGO_URI` not configured; no connection attempted | **Environment-blocked** (pre-existing gate, unchanged by this task) |
| 5 | `npm run frontend:lint` (during the preceding Practical 9 audit) | Clean (eslint, no findings) | Successful |
| 6 | `git diff --cached --check` (per commit) | Exit 0, no whitespace errors (one EOF blank line in `docs/practical-9.md` detected and fixed pre-commit) | Successful |

Pre-existing failures: **0**. Failures introduced by these commits: **0**.

*Note:* `npm test` runs via the script added in the still-uncommitted `backend/package.json`; the committed test file also runs directly with `node --test "test/cache.test.js"`.

---

## 6. Preservation verification

- **No destructive commands used:** no `git reset --hard`, no `git clean`, no `git checkout --`/`git restore`, no `git commit --amend`, no force-push, no push of any kind.
- **Staging was path-scoped only:** each commit staged one explicit file path; `git add .` / `git add -A` never used.
- **Unrelated diff is byte-identical to baseline.** `git diff --numstat` after all commits:

  ```
  159   1 README.md
  5     1 backend/.env.example
  3     1 backend/package.json
  76    1 backend/server.js
  17    7 backend/src/controllers/authController.js
  11    4 backend/src/middleware/errorHandler.js
  33    5 backend/src/middleware/logger.js
  3     1 backend/src/routes/authRoutes.js
  23    4 backend/src/services/emailService.js
  ```

  Totals: **9 files, 330 insertions, 25 deletions** = the initial 340/25 minus exactly the 10 lines of `docs/practical-9.md` now committed — i.e. **every unrelated file is untouched**.
- All 9 unrelated modified files and all untracked job-processing/rate-limiter/security/test-suite paths remain present in `git status` exactly as found (see §7).
- Sensitive files (`.env`, `GitHub token.txt`, `practical files/`) remain ignored and unstaged.

---

## 7. Final repository state

| Item | Value |
|---|---|
| Branch | `main` |
| Final HEAD | `docs: add Practical 9 commit audit report` (this file's commit; verify: `git log -1 --oneline`). Preceding: `244bac0`, `d18297f`, `d6dff4a`, `3b0ce81` |
| vs. `origin/main` | **ahead 4** (nothing pushed — push remains your decision) |
| Staged changes | **None** |
| Unstaged changes (all unrelated user work) | `README.md`, `backend/.env.example`, `backend/package.json`, `backend/server.js`, `backend/src/controllers/authController.js`, `backend/src/middleware/errorHandler.js`, `backend/src/middleware/logger.js`, `backend/src/routes/authRoutes.js`, `backend/src/services/emailService.js` |
| Untracked files (all unrelated user work) | `backend/src/config/jobConfig.js`, `backend/src/controllers/debugController.js`, `backend/src/middleware/rateLimiter.js`, `backend/src/models/jobModel.js`, `backend/src/security/`, `backend/src/services/jobService.js`, `backend/src/workers/`, `backend/test/{controller,dbGuard,emailWorker,encryption,jobModel,jobService,logging,rateLimiter,regression}.test.js`, `backend/test/helpers/`, `backend/test/integration/` |
| Practical 9 changes | **All committed** (nothing of Practical 9 remains uncommitted) |

**The working tree is NOT clean** — and correctly so: it began with substantial unrelated uncommitted work, which was preserved exactly as found rather than swept into these commits or discarded. The tree differs from its initial state only by: `docs/practical-9.md` moving from modified → committed, `docs/practical-9-audit.md` moving from untracked → committed, `backend/test/cache.test.js` moving from untracked → committed, and this new report file.

---

## 8. Readiness for Practical 10

**Ready.** Practical 9 is fully committed, tested (123/123 passing), and documented; no staged or in-progress Practical 9 work remains.

Outstanding items, none of which block Practical 10:

1. **Unrelated uncommitted work** (job-processing email worker, payload encryption, rate limiter, logging/error-handler changes, README/.env.example updates, and the rest of the test suite) remains in the working tree. When you want it committed, it should be split into its own reviewable groups (e.g. `feat: durable password-reset email jobs`, `feat: forgot-password rate limiting`, `test: add backend unit/integration suite`) — that work was intentionally out of scope here.
2. **Integration tests** are still environment-gated (need an approved isolated `*_test` database plus `RUN_INTEGRATION_TESTS=1`).
3. **No push performed** — `main` is 4 commits ahead of `origin/main`; push only when you explicitly decide to.
4. Practical 10 itself has **not** been started: no routes, event listeners, notification modules, or other new feature code were created by this task.

---

*Scope note: this report is the deliverable of the commit-audit task and is itself committed as its final commit; use `git log -1 -- docs/practical-9-commit-audit.md` for its exact hash.*
