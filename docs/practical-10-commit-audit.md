# Practical 10 — Smart Git Commit Audit

**Task:** Commit the verified Practical 10 implementation, tests and
documentation in small, logical, reviewable groups while preserving all
unrelated work.
**Repository:** `C:\Users\Admin\Desktop\sem 5\webdev` · branch
`feature/practical-10-events`
**Date:** 2026-10-25
**Authorization:** Local commits for verified, correctly-scoped changes only —
**no push, no amend, no `reset --hard`, no `git clean`, no history rewrite.**

---

## 1. Initial repository state

| Item | Value |
|---|---|
| Repository root | `C:\Users\Admin\Desktop\sem 5\webdev` (`.git` at root; `backend/`, `frontend/`, `docs/` are subdirectories) |
| Branch | `feature/practical-10-events` (no upstream/tracking configured) |
| Initial HEAD | `201b499d99c6eb17809a5e1e33ff01ad19ecb627` — *docs: add Practical 9 commit audit report* |
| Staged changes | **None** (`git diff --cached` empty) |
| Initial working tree | 9 modified tracked files + 18 untracked entries |

Initial `git status --porcelain`:

```text
 M README.md
 M backend/.env.example
 M backend/package.json
 M backend/server.js
 M backend/src/controllers/authController.js
 M backend/src/middleware/errorHandler.js
 M backend/src/middleware/logger.js
 M backend/src/routes/authRoutes.js
 M backend/src/services/emailService.js
?? backend/src/config/jobConfig.js
?? backend/src/controllers/debugController.js
?? backend/src/events/            <- Practical 10 (new)
?? backend/src/middleware/rateLimiter.js
?? backend/src/models/jobModel.js
?? backend/src/security/
?? backend/src/services/jobService.js
?? backend/src/workers/
?? backend/test/controller.test.js
?? backend/test/dbGuard.test.js
?? backend/test/emailWorker.test.js
?? backend/test/encryption.test.js
?? backend/test/helpers/
?? backend/test/integration/
?? backend/test/jobModel.test.js
?? backend/test/jobService.test.js
?? backend/test/logging.test.js
?? backend/test/rateLimiter.test.js
?? backend/test/regression.test.js
?? backend/test/taskEvents.test.js  <- Practical 10 (new)
?? backend/test_practical10.js      <- Practical 10 (new)
?? docs/practical-10-audit.md       <- Practical 10 (new)
?? docs/practical-10-events.md      <- Practical 10 (new)
```

### Classification performed before staging

| Group | Files | Verdict |
|---|---|---|
| **Practical 10** | `backend/src/events/taskEvents.js`, `backend/src/events/taskListeners.js` (new), `backend/src/controllers/taskController.js` (modified), `backend/server.js` (7 added lines), `backend/test/taskEvents.test.js`, `backend/test_practical10.js` (new), `docs/practical-10-events.md`, `docs/practical-10-audit.md` (new), `README.md` (2 added lines) | **Commit** |
| Pre-existing, unrelated | `backend/package.json` (adds the `test`/`test:integration` scripts), `backend/.env.example`, `backend/src/controllers/authController.js`, `backend/src/middleware/{errorHandler,logger}.js`, `backend/src/routes/authRoutes.js`, `backend/src/services/emailService.js`, and the 18 untracked job/encryption/rate-limiter/test-helper/integration entries | **Leave uncommitted** |

Verification that the mixed files really were mixed:

- `git diff backend/package.json` / `.env.example` — **100 % pre-existing**
  (test scripts, `JOB_PAYLOAD_ENCRYPTION_KEY`, integration-guard notes). Not
  touched by Practical 10 (the implementation added no dependency and no
  script), therefore **not staged**.
- `git diff backend/src/controllers/taskController.js` — **100 % Practical 10**
  (45 pure insertions; the file was *not* modified in the initial status), so
  the whole file was staged.
- `backend/server.js` — mixed: pre-existing email-worker/encryption/debug-route
  changes **plus** the 7-line Practical 10 registration. **Partially staged.**
- `README.md` — mixed: ~160 lines of pre-existing job-processing/integration
  documentation **plus** 2 Practical 10 lines. **Partially staged.**

No secret, `.env`, credential, database file, lockfile churn or generated
artifact was staged: the files to be committed were scanned with
`git grep -I -E "mongodb\+srv|mongodb://|JWT_SECRET=|JOB_PAYLOAD_ENCRYPTION_KEY=[0-9a-f]{64}"`
→ **no matches**.

---

## 2. Commits created

### Commit A — feature implementation

| | |
|---|---|
| Hash | `90527202fd7cc056032f98704974bfbd2e9e5ad3` |
| Message | `feat: add event-driven task notifications` |
| Files | `backend/src/events/taskEvents.js` (new, 46 lines) · `backend/src/events/taskListeners.js` (new, 163 lines) · `backend/src/controllers/taskController.js` (+45) · `backend/server.js` (+7) |
| Diff size | 4 files changed, 261 insertions(+) |

The `backend/server.js` portion of this commit contains **only** the Practical
10 hunks:

```diff
 import { cacheService } from './src/services/cacheService.js';
+import { registerTaskListeners } from './src/events/taskListeners.js';

 const app = express();

+// Practical 10: register background notification listeners exactly ONCE at
+// startup (the function is idempotent). ...
+registerTaskListeners();
+
 // 1. Global logging middleware (logs method, url, timestamp)
```

### Commit B — tests and demonstration

| | |
|---|---|
| Hash | `8e3f8b44e92145de813b1d797848336dc5ed5c7c` |
| Message | `test: cover asynchronous task event handling` |
| Files | `backend/test/taskEvents.test.js` (new, 564 lines) · `backend/test_practical10.js` (new, 155 lines) |
| Diff size | 2 files changed, 719 insertions(+) |

Scope check: both files import only from `node:test`/`node:assert` and from
Practical 10 + existing tracked modules (`taskEvents`, `taskListeners`,
`taskController`, `cacheService`, `taskModel`) — no dependency on untracked
pre-existing test helpers.

### Commit C — documentation and audit

| | |
|---|---|
| Hash | `2592f714f7df869ed0b3c07dca738446f75e7225` |
| Message | `docs: document Practical 10 implementation and audit` |
| Files | `docs/practical-10-events.md` (new, 462 lines) · `docs/practical-10-audit.md` (new, 365 lines) · `README.md` (+2) |
| Diff size | 3 files changed, 829 insertions(+) |

The `README.md` portion is exactly the two Practical 10 lines:

```diff
 - [Practical 9 In-Memory Caching & Query Optimization](docs/practical-9.md)
+- [Practical 10 Asynchronous Event-Driven Notifications](docs/practical-10-events.md)
...
 node test_practical9.js    # Practical 9 Cache & Benchmark tests
+node test_practical10.js   # Practical 10 event-driven notification demo
```

### Commit D — this report

| | |
|---|---|
| Message | `docs: add Practical 10 commit audit report` |
| Files | `docs/practical-10-commit-audit.md` |

Mirrors the Practical 9 convention (HEAD before this task was itself
*docs: add Practical 9 commit audit report*). Use
`git log -1 -- docs/practical-10-commit-audit.md` for its exact hash.

### How the two mixed files were separated safely

Both files were staged **without touching the working tree**, by writing an
index-only blob built from the HEAD version plus only the Practical 10 edits:

1. `git show HEAD:<path>` → exact HEAD blob;
2. insert only the Practical 10 lines (anchors verified to be unique);
3. `git hash-object -w --path <path> <temp>` (applies the path's filters);
4. `git update-index --add --cacheinfo 100644,<sha>,<path>`.

After each commit the remaining unstaged difference was re-checked to contain
**no** Practical 10 additions/removals:

- `backend/server.js`: `git diff` → only pre-existing work (the
  `registerTaskListeners` line appears solely as a context line).
- `README.md`: `git diff` filtered for `^[+-]` + `Practical 10` → **none**.

No `git add .`, no `git add -A`, no `git reset`, no `git checkout`, no
`git clean`, no amend, no rebase were used at any point.

---

## 3. Test results (actually executed)

### Working tree — before every commit

| When | Command | Result |
|---|---|---|
| Before commit A | `cd backend && npm test` | **138 tests, 138 pass, 0 fail** (2.02 s), 2026-10-25 19:35 +05:30 |
| Before commit B | `cd backend && npm test` | **138 tests, 138 pass, 0 fail** (2.07 s) |
| Before commit C | `cd backend && npm test` | **138 tests, 138 pass, 0 fail** (2.06 s) |

(123 pre-existing baseline + 15 Practical 10 tests — the historical baseline
and final figures were re-verified in this repository, not assumed.)

### Blocked / adjusted checks

| Check | Result |
|---|---|
| `npm run test:integration` | **BLOCKED — not bypassed.** 20 tests, 0 pass, 20 fail; every failure is the pre-existing `TestDatabaseNotApprovedError` refusal (*"RUN_INTEGRATION_TESTS=1 opt-in is not set"*). No production or dev database was substituted for an approved `*_test` database. Identical to the pre-task baseline. |
| `npm test` **inside the committed tree** | **Adjusted, then verified.** The committed `backend/package.json` (HEAD version) has only `start`/`dev` — the `test` script belongs to the pre-existing uncommitted package.json change, so it was deliberately **not** staged. Tests were therefore run in the committed tree as `node --test "test/*.test.js"`. |
| Backend lint / type-check | **Not applicable** — no such script exists in `backend/package.json` (only `start`, `dev` in the committed version). |

### Committed-tree (snapshot) verification — after commit C

To prove the commits are self-contained (no reliance on untracked files), the
committed tree was exported with `git archive HEAD` into a temp directory, a
directory junction supplied `node_modules`, and the suite was run there:

| Check | Result |
|---|---|
| `node --test "test/*.test.js"` in the exported HEAD tree | **29 tests, 29 pass, 0 fail** (1.17 s) = `test/cache.test.js` (Practical 9, 14) + `test/taskEvents.test.js` (Practical 10, 15); the only two test files tracked at HEAD |
| `node --check server.js` | syntax OK (ESM parse) |
| `node --check src/controllers/taskController.js` | syntax OK (ESM parse) |
| Listener registration from the committed modules | first call → `true`, second call → `false`, `listenerCount` = `task-created: 1, task-deleted: 1, error: 1` |

The temp export and junction were removed afterwards; the repository's
`backend/node_modules` was verified intact.

---

## 4. Uncommitted work preserved (and why)

**9 modified files** — all pre-existing, none related to Practical 10:

| File | Why excluded |
|---|---|
| `backend/package.json` | Adds the `test`/`test:integration` scripts for the pre-existing suite — written before Practical 10; staging it would stage unrelated work |
| `backend/.env.example` | `JOB_PAYLOAD_ENCRYPTION_KEY` + integration-guard notes (job-processing work) |
| `backend/server.js` | Its *remaining* unstaged diff: email worker, fail-fast encryption key, `/debug/jobs`, shutdown/unhandledRejection handling |
| `README.md` | Its *remaining* unstaged diff: job-processing, rate-limiting and integration-test documentation (~160 lines) |
| `backend/src/controllers/authController.js` | Password-reset job enqueue changes |
| `backend/src/middleware/errorHandler.js`, `backend/src/middleware/logger.js` | Redaction/logging changes for the reset-token work |
| `backend/src/routes/authRoutes.js` | Forgot-password rate-limit mounting |
| `backend/src/services/emailService.js` | SMTP send-path changes used by the worker |

**18 untracked entries** — all pre-existing: `src/config/jobConfig.js`,
`src/controllers/debugController.js`, `src/middleware/rateLimiter.js`,
`src/models/jobModel.js`, `src/security/`, `src/services/jobService.js`,
`src/workers/`, and `test/{controller,dbGuard,emailWorker,encryption,jobModel,jobService,logging,rateLimiter,regression}.test.js`,
`test/helpers/`, `test/integration/`.

Reason in every case: they belong to the unfinished password-reset job /
encryption / rate-limiter / logging / test-suite work, not to Practical 10.
They were neither staged, modified, moved nor deleted — the working tree keeps
every byte it had before this task. When that work is committed it should be
split into its own reviewable groups (e.g. `feat: durable password-reset email
jobs`, `feat: forgot-password rate limiting`, `test: add backend unit and
integration suite`).

One transparency note: `docs/practical-10-audit.md` was edited **before**
commit C to append a "Post-audit update" to §K, recording that its
commit recommendation was executed as groups A/B/C. No other line of that
report changed, and no evidence it contains was altered.

---

## 5. Final repository state

| Item | Value |
|---|---|
| Branch | `feature/practical-10-events` (still no upstream) |
| Final HEAD | the commit of *this* file — verify with `git log -1 --oneline` / `git log -1 -- docs/practical-10-commit-audit.md`. Preceding: `2592f71` → `8e3f8b4` → `9052720` → `201b499` |
| vs. `origin/main` | **ahead 4** (`origin/main` still points at `201b499`) |
| Staged changes | **None** (`git diff --cached` empty after every commit) |
| Unstaged changes | the same 9 pre-existing files listed in §4 |
| Untracked files | the same 18 pre-existing entries listed in §4 |
| Practical 10 files | **all committed** — nothing of Practical 10 remains uncommitted |
| Post-commit test run | `cd backend && npm test` → **138/138 pass** (working tree unchanged by committing) |

The working tree is **not clean** — correctly so: it began with substantial
unrelated uncommitted work, which was preserved exactly as found rather than
swept into these commits or discarded. Relative to its initial state it changed
only by: `backend/src/controllers/taskController.js` moving from *modified →
committed*, the four Practical 10 new files moving from *untracked →
committed*, and this new report file.

---

## 6. Push confirmation

**No push occurred.** `git push` was never executed in this task; no remote
refs were updated (`origin/main` remains at `201b499`, and the branch has no
upstream configured). Pushing remains your decision.

---

*Scope note: this report is the deliverable of the commit-audit task and is
itself committed as the final commit of the sequence, matching the Practical 9
convention; use `git log -1 -- docs/practical-10-commit-audit.md` for its
exact hash.*
