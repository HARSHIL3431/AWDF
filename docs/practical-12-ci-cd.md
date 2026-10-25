# Practical 12 — GitHub Actions CI/CD Implementation and Safety Audit

## 1. Objective and theory

Continuous Integration (CI) means every change is automatically built and
tested by a machine, immediately, instead of by a person just before a release.
A CI pipeline answers one question on every change: **does this change still
work?** If the answer is "no", the change is blocked while it is still cheap to
fix.

The theory behind the pipeline implemented here:

1. **Reproducibility** — the job starts from a clean runner, checks out the
   committed tree and installs dependencies from the lockfile-checked manifest.
   Nothing from a developer machine leaks in (no `.env`, no `node_modules`, no
   local `dist`).
2. **Fast feedback** — tests run in seconds, so a mistake is discovered minutes
   after it is written, not days later.
3. **Gate** — a non-zero exit code turns the job red, which blocks a pull
   request from being merged with a green-looking but broken change.
4. **Least privilege** — the workflow needs no secrets and only
   `contents: read`, so a compromised third-party action cannot push code or
   read credentials.

## 2. CI versus CD — why this practical is CI

| | Continuous **Integration** | Continuous **Delivery/Deployment** |
|---|---|---|
| Question | "Does the change still work?" | "Ship the change to users" |
| Typical steps | install → test → lint → build | package → publish → deploy → smoke test |
| Needs credentials | no | yes (registry, cloud, SSH, secrets) |
| Failure cost | a red badge | an outage |

This practical demonstrates **CI only**:

- The workflow installs, tests, lints and builds. It **deploys nothing** — no
  Docker push, no server, no cloud account.
- It uses **zero secrets**, so nothing in it can reach production.
- The word "CD" in the practical title is covered *theoretically* (§2 table,
  §10) rather than by an actual deployment job, because deploying is explicitly
  out of scope and would require authorization and credentials.

## 3. Workflow: triggers, jobs, steps, Node version

**Path:** `.github/workflows/ci.yml` (exact path, verified)
**Name:** `CI Pipeline`

### Triggers

| Event | Branch | Purpose |
|---|---|---|
| `push` | `main` | every commit landing on `main` is verified |
| `pull_request` | target `main` | every proposed change is verified *before* merge; a red X blocks the merge |

Feature-branch pushes alone do **not** trigger a run — this keeps CI focused on
changes that are heading towards `main`, and it is what makes the
red/green demonstration in §7–§8 possible through a pull request.

### Jobs

| Job id | Display name | Runner | Timeout | Steps |
|---|---|---|---|---|
| `backend-tests` | Backend tests | `ubuntu-latest` | 10 min | checkout → setup-node → `npm install` → verify test files → `npm test` |
| `frontend-checks` | Frontend lint and build | `ubuntu-latest` | 10 min | checkout → setup-node → `npm install` → lint → build |

Two independent jobs means the failing area names itself on the workflow page
(red **Backend tests**, green **Frontend lint and build**), and they run in
parallel. Both use `actions/checkout@v4` and `actions/setup-node@v4`, with
`permissions: contents: read`.

### Node.js version: 24 (not 18)

| Constraint | Required | Chosen |
|---|---|---|
| `vite` engines | `^20.19 \|\| >=22.12` | 24 ✓ |
| `mongoose` engines | `>=20.19` | 24 ✓ |
| Project development runtime | Node **24.12.0** (`node -v` locally) | 24 ✓ |

Node 18 would fail `vite`'s engines check, so `node-version: 24` is used. The
workflow also enables npm caching keyed on each package's own lockfile.

## 4. Dependency installation and test commands

The repository has **three independent manifests** and npm must only run where a
manifest exists:

| Directory | `package.json` | `package-lock.json` | Used by CI for |
|---|---|---|---|
| `backend/` | yes | yes | `npm install` → dependencies for the tests |
| `frontend/` | yes | yes | `npm install` → dependencies for lint/build |
| root | yes | **no** | `npm test`, `npm run frontend:lint`, `npm run frontend:build` (scripts only) |

Root `npm install` is deliberately **skipped**: it has no dependencies and no
lockfile, and running it would only generate a stray `package-lock.json`.

### The test command

```bash
npm install     # in backend/   — explicit install step, as the practical requires
npm test        # at the root   — runs node --test "backend/test/*.test.js"
```

The root `package.json` gained exactly one line (it was otherwise unmodified):

```json
"test": "node --test \"backend/test/*.test.js\""
```

**Why the script lives at the root and not in `backend/package.json`:**
the *committed* `backend/package.json` has no `test` script at all — only
`start` and `dev`. The `test` / `test:integration` scripts exist solely in a
pre-existing **uncommitted** modification of that file, which I am not allowed
to stage. Evidence:

```text
$ git show HEAD:backend/package.json
  "scripts": { "start": "node server.js", "dev": "nodemon server.js" }
$ cd <clean-clone>/backend && npm test
  npm error Missing script: "test"     -> exit 1
```

The root script therefore gives the pipeline a configured test command without
touching anyone else's work. (Once the pre-existing work is committed, the root
script can be simplified to `npm --prefix backend run test`.)

**Why the glob is `backend/test/*.test.js` and not a directory scan:**
the glob is *non-recursive*, so `backend/test/integration/*.test.js` — the
database-gated suite — is never picked up. `node --test backend/test/` would
scan recursively and run it, which must not happen (§11).

The runner is Node's **built-in `node --test`** — no new test framework was
added, and no second linter job was introduced.

## 5. Local verification results

Everything below was executed on this machine. Nothing is simulated.

### Baseline before any edit

| Command | Where | Result |
|---|---|---|
| `git status --short --branch` | repo | branch `feature/practical-10-events`, index clean |
| `npm test` (full local suite) | repo, scrubbed env | **138/138 pass**, exit 0 |
| `npm test` (backend, committed scripts) | clean clone | **exit 1 — `Missing script: "test"`** |
| `node --test "test/*.test.js"` | clean clone | **29/29 pass**, exit 0 |
| `npm run test:integration` | repo | exit 1 — **blocked by the database guard** (not bypassed) |
| `.github/` | repo | did not exist — no prior workflows |

### After implementing the workflow

| Check | Command / tool | Result |
|---|---|---|
| YAML syntax + Actions semantics | `python p12-validate.py` (PyYAML 6.0.3 + structural rules) | **exit 0, 0 errors** |
| Workflow path | validator | `.github/workflows/ci.yml` ✓ |
| `npm install` (backend) | clean clone | **exit 0**, lockfile **unmodified** |
| `npm install` (frontend) | clean clone | **exit 0** |
| `npm test` | clean clone (CI-equivalent) | **29/29 pass**, exit 0 |
| `npm test` | working tree (all local tests) | **138/138 pass**, exit 0 |
| `npm run frontend:lint` | clean clone | **exit 0** |
| `npm run frontend:build` | clean clone | **exit 0**, `index-BrN_1fWK.js` 372.01 kB |
| Failure propagation | clean clone, assertion changed `201`→`999`, then `npm test` | **exit 1** with `AssertionError: actual 201, expected 999` |
| Test-file guard (`ls -1`) | Git Bash, positive / negative | **exit 0** / **exit 2** (`No such file or directory`) |
| Secrets in workflow | scan for `secrets.`/`.env`/token literals | **none** (the only "secret" match is the word in a comment) |
| No env/DB dependence | copied `backend/` **without `.env`** (robocopy + junctioned `node_modules`), scrubbed all secret env vars, ran the suite | **29/29 pass** |

**Clean-clone methodology:** `git clone --no-hardlinks` of this branch into
`%TEMP%\opencode\p12-ci-sim`, then `npm install` + tests there. That directory
contains exactly the files GitHub will check out — which is why the CI test
count is **29**, not 138 (§11).

## 6. GitHub Actions runs — not yet verified

**No GitHub Actions run has been observed.** No run URL, run ID, timestamp or
green check mark is claimed anywhere in this document.

Reason: runs only exist after a push/PR, and pushing requires explicit
authorization (§16). Additionally the `gh` CLI is **not installed** on this
machine (`gh --version` → not found) and there is no browser access, so a run
cannot be queried even after it happens without further tooling.

### Exact instructions to produce the first run (manual)

```bash
# 1. after authorizing the push of the Practical 12 commits:
git push origin feature/practical-10-events

# 2. open a pull request: feature/practical-10-events -> main
#    (GitHub -> Pull requests -> New pull request)
#    the `pull_request` trigger fires `CI Pipeline` automatically

# 3. observe: https://github.com/HARSHIL3431/AWDF/actions
```

The workflow file must be present in the PR's merge ref for `pull_request` to
fire it — it is, because the Practical 12 commit is part of the PR branch.

## 7. Failed-run evidence (required red demonstration)

**Status: prepared locally, NOT yet captured from GitHub.**

The planned demonstration (§16 gives the approval-gated steps):

1. Branch `demo/practical-12-failing-test` off the CI-bearing branch.
2. Change **one assertion in a tracked test** — `backend/test/cache.test.js`
   line 220: `assert.equal(res.statusCode, 201)` → `999`. No application code,
   no database control, no safety guard is touched.
3. Push the branch and open a PR against `main` → the `pull_request` trigger
   runs `CI Pipeline`.
4. Capture the red X, the job log, the failing assertion and the run URL.
5. Revert the assertion on the same branch → the same PR turns green.
6. The demo branch is never merged; its final state contains **no** failing
   test.

**Local equivalent, already executed** (clean clone, exact CI command):

```text
$ npm test
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    actual: 201,
    expected: 999,
$ echo $?
1
```

- Run URL: **PENDING** (no authorized push yet)
- Job log / red X screenshot: **PENDING** — placeholder `docs/evidence/practical-12/01-failed-run.png`

## 8. Fixed-run evidence (required green demonstration)

**Status: prepared locally, NOT yet captured from GitHub.**

- Local green proof of the same command: **29/29 pass, exit 0** in the clean
  clone (§5), and **138/138, exit 0** in the working tree.
- Run URL for the corrected push: **PENDING** — placeholder
  `docs/evidence/practical-12/02-passing-run.png`

Because no run exists yet, no run link or badge result is asserted.

## 9. Incorrect test file path vs genuine failed assertion

All three cases were executed, not theorized:

| Case | Command | What the log shows | Exit code | CI result |
|---|---|---|---|---|
| **A. Wrong glob, matches nothing** | `node --test "test/does-not-exist/*.test.js"` | summary with `tests 0` | **0** | ⚠️ **green while testing nothing** |
| **B. Wrong literal file path** | `node --test "test/does-not-exist.test.js"` | `Could not find 'test/does-not-exist.test.js'` | **1** | red — but the cause is a *typo*, not a defect |
| **C. Correct path, genuine assertion failure** | `node --test "backend/test/*.test.js"` with `201`→`999` | `AssertionError … actual: 201, expected: 999` + file/line | **1** | red — a real regression |

The important difference: **B and C both fail, but for completely different
reasons** — B never ran a test, C ran the tests and one contract broke. Only C
is evidence about the software.

**Case A is the dangerous one**: a glob that matches nothing is a *silent*
success. The workflow guards against it with an explicit step:

```yaml
- name: Verify test files are present
  run: ls -1 backend/test/*.test.js
```

Verified in bash: exits `0` and lists the files when they exist, exits `2` with
`No such file or directory` when they do not. When reading a real run, also
check the `ℹ tests N` line: **N = 0 would mean the path is wrong, not that the
code is perfect.**

## 10. Why automatic testing catches regressions earlier

Manual testing usually happens *just before a release*, when a bug is expensive:
it has to be diagnosed, re-tested, and re-released. CI moves the same checks to
**every push/PR**, when the change is a few minutes old and the diff is small.

Concretely for this repository:

- A change to `taskController` that forgets to invalidate the cache is caught by
  the `POST invalidates the list cache` test on the PR, not by a user receiving
  stale tasks in production.
- A change that emits a second `task-created` event (double notification) is
  caught by `creation: exactly one task-created event`.
- Because the runner is clean, CI also catches "works on my machine" problems:
  a file whose import path has the wrong case (a real bug fixed in Practical
 11), or a dependency that was never added to `package.json`.

## 11. Known limitations

1. **Database-gated integration suite is not run in CI.**
   `npm run test:integration` (3 files under `backend/test/integration/`) is
   refused by the pre-existing safety guard, which requires **both**
   `RUN_INTEGRATION_TESTS=1` **and** an approved `*_test` `TEST_MONGO_URI`.
   CI must not bypass that guard and has no approved database, so the workflow
   never invokes it (the validator asserts this). Local attempt: exit 1,
   `TestDatabaseNotApprovedError`. **No integration result is claimed.**
2. **CI runs 29 tests, the local tree runs 138.** Only *committed* files are
   checked out, and only `backend/test/cache.test.js` (14 tests) and
   `backend/test/taskEvents.test.js` (15 tests) are tracked. The other 9 test
   files are part of the pre-existing uncommitted work and must not be staged.
   The glob is file-based, so **as soon as those files are committed the CI
   count grows automatically** — no workflow change needed.
3. **A pre-existing flaky test exists** (outside CI's scope):
   `backend/test/jobService.test.js:223` asserts that `claimDueJob` returns the
   recovered job, but `recoverExpiredLeases` stamps `nextAttemptAt` with the
   recovery time while the comparison job carries its insert time — so the
   assertion only holds when both land in the **same millisecond**. Observed
   1 failure then 1 pass with identical inputs. It is untracked, so CI never
   runs it. **Not fixed here** (it belongs to the pre-existing work).
4. **`frontend/.env` is absent in CI** (it is gitignored and holds
   `VITE_GITHUB_USERNAME` / `VITE_GITHUB_TOKEN`). The clean build succeeds with
   exit 0, and the bundle hash differs from a machine that has that file —
   this is expected and also means **no local client token is baked into a CI
   build**.
5. **`npm install` reports 6 pre-existing vulnerabilities** (3 moderate, 2 high,
   1 critical) in the frontend dependency tree. Not addressed here: `npm audit
   fix` would change dependencies, which is out of scope and not authorized.
6. **No GitHub run has been observed yet** (§6), so §7/§8 remain pending and
   the README badge is unverified until the first run exists.

## 12. Supplementary linter configuration

Linting is **included**, inside the existing `frontend-checks` job:

```text
npm run frontend:lint   ->  npm --prefix frontend run lint  ->  eslint .
```

- Exit code 0 locally on the clean clone.
- **No separate linter job was added**: a second job would re-check out the
  repository and re-install dependencies just to run one command already
  covered here — pure duplication, no extra signal.
- No new linter, plugin or dependency was introduced.

## 13. README status badge

Repository identity (verified with `git remote -v`):
`https://github.com/HARSHIL3431/AWDF.git`
Workflow file: `.github/workflows/ci.yml`, workflow name `CI Pipeline`.

```markdown
[![CI Pipeline](https://github.com/HARSHIL3431/AWDF/actions/workflows/ci.yml/badge.svg)](https://github.com/HARSHIL3431/AWDF/actions/workflows/ci.yml)
```

- The badge URL is derived from the verified repository + workflow file name,
  so the *link* is correct by construction.
- The badge **status is not yet verified**: the badge reports the latest run on
  the default branch, and no run exists until §6 is executed. Until then it
  renders as "no status".
- The README was staged **partially** — only the badge line was committed; the
  ~159 pre-existing uncommitted documentation lines remain untouched and
  unstaged.

## 14. Screenshot / evidence placeholders

| Evidence | Status | Expected path |
|---|---|---|
| Failed run (red X + assertion) | PENDING | `docs/evidence/practical-12/01-failed-run.png` |
| Passing run (green check) | PENDING | `docs/evidence/practical-12/02-passing-run.png` |
| Workflow run list page | PENDING | `docs/evidence/practical-12/03-run-list.png` |
| Local test output (29/29) | available on request | terminal transcript, §5 |
| Local failure output (201≠999) | available on request | terminal transcript, §7 |

No screenshot, run ID, URL or timestamp has been fabricated.

## 15. Viva-ready test cases

Both come from the **tracked** suite, so both actually run in CI.

### Test case 1 — endpoint `GET /tasks` (cache behaviour)

- **File:** `backend/test/cache.test.js`
- **Title:** `cache: first GET /tasks is a miss that queries the DB, the repeat is a hit that does not`
- **What it does:** performs the same request twice through the real controller
  with a counting database stub; asserts `200` both times, that the first call
  queries the database and the second does not, and that the responses
  serialize identically.
- **Expected result:** `tests 1` → pass, exit 0. Break the invalidation and the
  test fails with an assertion on hit/miss counts.
- **Why it matters:** it protects performance *and* correctness — a regression
  here would serve stale task lists to users.

### Test case 2 — endpoint `POST /tasks` (event contract)

- **File:** `backend/test/taskEvents.test.js`
- **Title:** `creation: exactly one task-created event, 201 contract preserved, notification not awaited`
- **What it does:** creates a task through the real controller and asserts the
  HTTP contract is still `201`, that **exactly one** `task-created` event was
  emitted on the shared emitter, and that the response is not delayed by
  listeners.
- **Expected result:** pass, exit 0. Emitting twice (duplicate listener) or
  zero times (missing emit) fails the assertion with the observed vs expected
  payload.
- **Why it matters:** it prevents duplicate notifications and protects the
  public API status code at the same time.

*(Bonus third endpoint: `DELETE /tasks/:id` is covered by
`deletion: exactly one task-deleted event … response and cache invalidation
preserved`.)*

## 16. Reflection — errors encountered and how they were resolved

1. **Assumed `npm test` worked in the backend.** It does locally only because
   the script sits in an *uncommitted* `backend/package.json`. A clean clone
   proved it fails with `Missing script: "test"`. Resolved by configuring
   `test` in the root manifest (an unmodified file I own) instead of staging
   someone else's change.
2. **The first "CI-like" run was not CI-like.** Scrubbing environment variables
   was not enough: tests import `authController` → `config.js` →
   `dotenv.config()`, which re-read `backend/.env` from disk. Resolved by
   building a copy of `backend/` with **no `.env` at all** (robocopy excluding
   it, `node_modules` linked by junction) and re-running: 29/29.
3. **My own validator produced a false positive**, flagging
   `test:integration` that only appeared inside a YAML comment. Resolved by
   restricting the rule to actual `run:` commands — the check now passes
   legitimately instead of being deleted.
4. **A PowerShell alias hid the guard's real behaviour**: `ls` resolved to
   `Get-ChildItem` and `-1` was parsed as a path. Resolved by running the exact
   command through Git Bash, where it correctly exits 0 / 2.
5. **A disposable-clone experiment deleted that clone's `package.json`.**
   Resolved by restoring the bytes from the clone's own `HEAD` and re-cloning
   before reusing it as evidence; the real repository was never touched by the
   experiment.
6. **A test failed once and passed on the next identical run.** Rather than
   ignore it, I traced it to a millisecond-level timing dependency
   (§11.3) and documented it as a known flaky test — it is untracked, so it
   cannot make CI red.

## 17. Git safety rules observed

- No `git add .` / `git add -A`; every staged path listed before each commit.
- The pre-existing backend/job/security/rate-limiter/test work was **not**
  staged — including `backend/package.json`, whose `test`/`test:integration`
  scripts were deliberately left uncommitted.
- No `.env`, credential, token, `dist/`, `node_modules` or test artifact staged
  or written into the workflow.
- No `reset`, `clean`, `restore`, `stash`, amend, force-push, merge or rebase.
- No push of any branch without explicit authorization; no GitHub Actions run
  claimed without an actual remote run.
- Docker Compose stack and the `task-management_mongo_data` volume untouched;
  `docker compose down -v` never used; no database record or account deleted.
- The integration guard was never bypassed.
