# Practical 12 — Commit Audit and Safety Report

Git evidence for the Practical 12 (GitHub Actions CI) work: what changed, what
was verified, what was deliberately *not* done.

---

## 1. Starting and ending state

| Item | Starting | Ending |
|---|---|---|
| Branch | `feature/practical-10-events` | `feature/practical-10-events` (unchanged) |
| HEAD | `133af33aafe67e49bb7dbfb6d49dfbf0de55758b` | `57fae52faeb37cdff86470a0ff4b59a80c988019` + this report |
| Upstream | `origin/feature/practical-10-events` | same, **0 behind / 2 ahead** |
| Staged | none (index empty) | empty after every commit |
| Stash | none | none |
| Modified tracked files | 9 (all pre-existing) | 9 (identical set) |
| Untracked entries | 18 (all pre-existing) | 18 (identical set) |
| Docker stack | `backend`/`frontend`/`mongodb` healthy, volume `task-management_mongo_data` | unchanged, still healthy, volume intact |

No branch switch, merge, rebase, reset, amend, restore, stash or force-push was
performed at any point.

## 2. Remote refs observed

`git fetch origin --prune` (exit 0) was run once, read-only.

| Ref | Value | Observation |
|---|---|---|
| `origin/feature/practical-10-events` | `133af33` | **The five Practical 11 commits had already been pushed** between sessions — the reflog shows `133af33 … update by push`. Practical 11 was therefore pushed but **not merged** into `main`. |
| `origin/main` | `e9bd728` | *Merge pull request #1 … feature/practical-10-events* — contains Practical 10 only. |
| local `main` | `201b499` | **0 ahead / 5 behind** `origin/main`. |

Practical 12 work started from a branch that was fully in sync with its
upstream, so the two new commits are the only divergence.

## 3. Commits created

| # | Hash | Message | Files |
|---|---|---|---|
| 1 | `3cd9283846f1f59a996b1c0aba38210efb2aa91d` | `ci: add GitHub Actions test workflow` | 2 (+95 / −1) |
| 2 | `57fae52faeb37cdff86470a0ff4b59a80c988019` | `docs: document Practical 12 CI verification` | 2 (+439) |
| 3 | this file | `docs: add Practical 12 commit audit report` | 1 |

`git show --check` returned **exit 0** (no whitespace errors) for every commit,
and `git show --stat` was inspected after each one.

### Commit 1 — `3cd9283` (2 files, +95 / −1)

```text
.github/workflows/ci.yml   93 +   (new)
package.json                3 +-  (adds one "test" script line)
```

The `package.json` change in full:

```diff
-    "start": "npm run backend:start"
+    "start": "npm run backend:start",
+    "test": "node --test \"backend/test/*.test.js\""
```

`package.json` was chosen because it is the **only** manifest that is
*unmodified* in the working tree — staging it therefore commits exactly one
line of my own work. `backend/package.json`, which carries a pre-existing
uncommitted `test`/`test:integration` addition, was deliberately **left
unstaged** (see §6).

### Commit 2 — `57fae52` (2 files, +439)

```text
README.md                    2 +   (badge line + blank line only)
docs/practical-12-ci-cd.md   437 + (new)
```

README was staged **partially** using index-level blob surgery (build the blob
from `git show HEAD:README.md` + only the badge lines, hash it, write it into
the index) — the same verified technique used in Practicals 10 and 11.

Result verified before committing:

| | additions | deletions |
|---|---|---|
| Staged (`HEAD` → index) | **2** | 0 |
| Unstaged (index → worktree) | **159** | **1** |

The ~159 pre-existing job-processing documentation lines and their single
deletion remain **unstaged and byte-identical** to before this practical.

## 4. Tests and validation actually run

All executed on this machine; nothing simulated.

| Check | Command / tool | Result |
|---|---|---|
| Workflow YAML + Actions semantics | `python p12-validate.py` (PyYAML 6.0.3) | **exit 0, 0 errors** |
| Workflow path | validator | exactly `.github/workflows/ci.yml` ✓ |
| Install (backend) | clean clone, `npm install` | **exit 0**, lockfile unmodified |
| Install (frontend) | clean clone, `npm install` | **exit 0** |
| Full CI sequence (both jobs) | fresh clone of `57fae52`, all 5 steps | **ALL PASS** |
| Tests, CI-equivalent | fresh clone, `npm test` | **29 / 29 pass, fail 0, exit 0** |
| Tests, working tree | `npm test` (includes uncommitted tests) | **138 / 138 pass, exit 0** |
| Lint | `npm run frontend:lint` | **exit 0** |
| Build | `npm run frontend:build` | **exit 0** |
| Failure propagation | assertion `201` → `999`, then `npm test` | **exit 1**, `AssertionError: actual 201, expected 999` |
| Wrong glob path | `node --test "test/does-not-exist/*.test.js"` | **exit 0 with 0 tests** (silent — guarded) |
| Wrong literal path | `node --test "test/does-not-exist.test.js"` | **exit 1**, `Could not find …` |
| Test-file guard | `ls -1 backend/test/*.test.js` in Git Bash | **exit 0** present / **exit 2** absent |
| No-`.env` environment | robocopy of `backend/` **excluding `.env`**, junctioned `node_modules`, all secret env vars scrubbed | **29 / 29 pass** |
| Secrets in the workflow | scan for `secrets.`, `.env`, token literals | **none** |
| Clone cleanliness after full run | `git status --porcelain` in clone | **empty** |

### Integration tests blocked by the safety guard

```text
$ cd backend && npm run test:integration
  TestDatabaseNotApprovedError  (backend/test/helpers/dbGuard.js)
  exit 1
```

The guard requires **both** `RUN_INTEGRATION_TESTS=1` **and** an approved
`*_test` `TEST_MONGO_URI`. It was **not** bypassed, and the workflow contains
no step that invokes the integration suite (the validator asserts this).
**No integration test result is claimed.**

## 5. Unrelated changes preserved

Verified identical before and after the Practical 12 work:

- **9 modified tracked files**, all pre-existing:
  `README.md` (unstaged badge-adjacent pre-existing lines),
  `backend/.env.example`, `backend/package.json`, `backend/server.js`,
  `backend/src/controllers/authController.js`,
  `backend/src/middleware/errorHandler.js`,
  `backend/src/middleware/logger.js`,
  `backend/src/routes/authRoutes.js`,
  `backend/src/services/emailService.js`
- **18 untracked entries**, all pre-existing job/encryption/rate-limiter/logging
  work plus their tests (list in §6)
- `git stash list` empty; index empty after every commit
- Docker Compose stack untouched: three services healthy, named volume
  `task-management_mongo_data` present, `docker compose down -v` never used
- No database record or user account was created or deleted as "cleanup"
- No `.env`, credential, token, `dist/`, `node_modules` or test artifact staged
  or copied into the workflow

## 6. Remaining untracked files (untouched by this practical)

```text
backend/src/config/jobConfig.js       backend/src/controllers/debugController.js
backend/src/middleware/rateLimiter.js backend/src/models/jobModel.js
backend/src/security/                 backend/src/services/jobService.js
backend/src/workers/                  backend/test/controller.test.js
backend/test/dbGuard.test.js          backend/test/emailWorker.test.js
backend/test/encryption.test.js       backend/test/helpers/
backend/test/integration/             backend/test/jobModel.test.js
backend/test/jobService.test.js       backend/test/logging.test.js
backend/test/rateLimiter.test.js      backend/test/regression.test.js
```

Additionally `backend/package.json` still carries its **uncommitted** `test` /
`test:integration` scripts. Staging that file would publish someone else's
in-progress change, so it was excluded — the pipeline instead gets its
`npm test` from the root manifest (§3).

## 7. Remote push and GitHub Actions runs

| Question | Answer |
|---|---|
| Was any branch pushed? | **No.** `git push` was never executed in this practical. |
| Are the Practical 12 commits on the remote? | **No** — they exist only locally (`ahead 2`). |
| Has a GitHub Actions run been observed? | **No.** |
| Any run URL / run ID / green check claimed? | **No — none exists yet.** |
| Can runs be queried from this machine? | The `gh` CLI is **not installed** (`gh --version` → not found) and there is no browser access. |

A run can only exist after an authorized push (the workflow triggers on push to
`main` and on pull requests targeting `main`). The exact instructions for
producing the first run are in `docs/practical-12-ci-cd.md` §6; the red/green
demonstration procedure is in §7–§8.

## 8. Known limitations

1. **No remote verification yet** — workflow correctness is proven only by
   local execution (clean-clone CI sequence), YAML/semantic validation and
   failure-propagation tests. GitHub has not run this workflow.
2. **CI executes 29 tests, not 138** — only committed files are checked out;
   9 of the 11 test files are pre-existing uncommitted work. The glob picks up
   newly committed tests automatically, so the count rises when that work is
   committed.
3. **A pre-existing flaky test** exists at `backend/test/jobService.test.js:223`
   (millisecond-level timing dependency between `recoverExpiredLeases` and
   `claimDueJob`). It is untracked, so CI never runs it; it was reported, not
   fixed, because it belongs to the pre-existing work.
4. **Integration suite remains gated** (§4) — CI covers unit/behavioural tests
   only.
5. **README badge is unverified** — its URL is derived from the verified
   repository (`HARSHIL3431/AWDF`) and workflow file name, but the badge shows
   a real status only after the first run on the default branch.
6. **6 pre-existing npm vulnerabilities** (3 moderate, 2 high, 1 critical) were
   reported by `npm install`; fixing them would modify dependencies and was out
   of scope.

## 9. Safety rules observed

- No `git add .` / `git add -A` — every staged path was listed and inspected
  before each commit; a guard command checked for pre-existing files after
  staging.
- The pre-existing backend/job/security/rate-limiter/test work was never
  staged, including `backend/package.json`.
- No `reset`, `clean`, `restore`, `checkout --`, `stash`, amend, force-push,
  merge or rebase.
- No push of any branch; no history rewrite; no force operations.
- The database safety guard was never bypassed; no unsafe database action.
- No production deployment, no Docker push, no secret written to the workflow.
- The Docker stack and its named volume were preserved; `docker compose down -v`
  was never run.
- The deliberate failing-test experiments were performed only inside
  a disposable clone under `%TEMP%`, never in the repository.
