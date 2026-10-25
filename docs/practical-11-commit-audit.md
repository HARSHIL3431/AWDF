# Practical 11 — Commit Audit

Repository state, commit construction and verification evidence for the
Practical 11 (Docker containerization) work, including a remote-safety review.
No history was rewritten, nothing was pushed and every unrelated change was
left untouched.

---

## 1. Initial repository state (before any commit)

| Item | Value |
|---|---|
| Repository root | `C:/Users/Admin/Desktop/sem 5/webdev` |
| Branch | `feature/practical-10-events` |
| HEAD | `f9cffd94092257a48e83a7b43fb98a7fcb89cbc1` — *docs: add Practical 10 commit audit report* |
| Upstream | `origin/feature/practical-10-events`, **0 ahead / 0 behind** (in sync) |
| Staged | none — `git diff --cached` empty |
| Stash | none (`git stash list` empty) |
| Working tree | 13 modified + 26 untracked (4 modified + 8 untracked were the Practical 11 files, the rest pre-existing) |
| Pre-existing work present | 9 modified backend files + 18 untracked `backend/` entries (job processing, encryption, rate limiter, logging, auth, email, tests) + ~159 unstaged README lines |
| Live stack | `backend`, `frontend`, `mongodb` all `healthy`; volume `task-management_mongo_data` mounted |

No destructive command (`reset --hard`, `clean`, `restore`, `checkout`, `stash`)
was used at any point, and no file was discarded or overwritten.

## 2. Remote and local branch comparison

`git fetch origin` (run at the start of this pass, exit 0) reported
`origin/main 201b499..e9bd728`.

| Ref | Commit | Note |
|---|---|---|
| `origin/main` | `e9bd728a8ae45d73e21fd6c1843805d1a93ae87f` | *Merge pull request #1 from HARSHIL3431/feature/practical-10-events* (committer GitHub, parents `201b499` + `f9cffd9`) |
| local `main` | `201b499` | **0 ahead / 5 behind** `origin/main` |
| `origin/feature/practical-10-events` | `f9cffd9` | unchanged — the branch was **not** pushed |

**Commits that were "missing" locally:** the four Practical 10 commits
(`9052720`, `8e3f8b4`, `2592f71`, `f9cffd9`) plus the merge commit `e9bd728`.
The four Practical 10 commits were already present locally; only the merge
commit itself was new.

**Content comparison (the fact that matters):**

| Check | Result |
|---|---|
| `git diff --stat f9cffd9 origin/main` | **empty (0 diff lines)** — trees are identical (`7ca126bd…`) |
| `git merge-base HEAD origin/main` | `f9cffd9` — Practical 10 tip |
| `git rev-list --left-right --count HEAD...origin/main` | `4` local-only / `1` remote-only (the content-identical merge commit) |
| `git merge-tree --write-tree HEAD origin/main` (read-only, in-memory) | **exit 0**, tree `2f9f2365…`, **no conflicts** |

Conclusion: `origin/main` carries **zero file changes** relative to `f9cffd9`.
Because every locally modified file is dirty relative to that same content, an
integration of `origin/main` cannot touch those files and therefore cannot
conflict with the uncommitted work. See §9 for the recommended next step.

## 3. Commits created

All authored by the repository's configured author, all on
`feature/practical-10-events`, **none pushed**.

| # | Hash | Message |
|---|---|---|
| 1 | `3de50497b329123258e82e5eb07216326bee5473` | `feat: add Dockerfiles and Compose orchestration` |
| 2 | `9043117409780f321cc33173ab87900e6d67b82a` | `feat: make frontend API base URL configurable at build time` |
| 3 | `f18e576579647816d4112e891cbc267eaa8ac6ed` | `fix: correct frontend import path casing` |
| 4 | `f2803a08049e8db28fbae2afbcd1aec070192d04` | `docs: document Practical 11 Docker setup and audit` |
| 5 | this file | `docs: add Practical 11 commit audit report` |

Total Practical 11 delta (commits 1–4): **13 files changed, 1356 insertions(+),
13 deletions(-)**.

### Grouping rationale

Commits 1–4 follow the requested split (Docker configuration / frontend fix /
documentation). Commit 2 exists because the `VITE_API_URL` wiring in
`authService.js` and `taskService.js` is **application source** consumed by the
Dockerfile build arg: folding it into commit 1 would hide an app-code change
inside an infrastructure commit, and folding it into commit 3 would break that
commit's promise of containing nothing but import-path case fixes. Splitting it
keeps every commit independently reviewable and its message an exact description
of its contents.

## 4. Files included in each commit (verified with `git show --check` + `git show --stat`)

**Commit 1 — `3de5049` (6 files, +312)**

```text
.dockerignore              backend/.dockerignore   backend/Dockerfile
docker-compose.yml         frontend/.dockerignore  frontend/Dockerfile
```

**Commit 2 — `9043117` (2 files, +8 / −2)**

```text
frontend/src/services/authService.js   frontend/src/services/taskService.js
```

**Commit 3 — `f18e576` (2 files, +11 / −11)**

```text
frontend/src/pages/Home.jsx     frontend/src/pages/Projects.jsx
```

Every changed line in commit 3 was machine-checked: all 22 changed lines are
`import … from '../components/…'` → `'../Components/…'` corrections, nothing
else. A case-sensitive repository scan confirmed **0** remaining lowercase
`../components/` specifiers and no other file needing the fix (the
case-insensitive count of 12 refers to already-correct `../Components/` uses).

**Commit 4 — `f2803a0` (3 files, +1025)**

```text
README.md                    +36  (partial stage — see below)
docs/practical-11-docker.md  +567
docs/practical-11-audit.md   +422
```

**Commit 5 — this file** `docs/practical-11-commit-audit.md`.

### README partial staging (the file that could not be staged wholesale)

`git diff` reported the README as **one merged hunk** (`@@ -46,17 +46,176 @@`),
so interactive staging (`git add -p`) could not separate the 36 Practical 11
lines from the ~159 pre-existing job-processing lines. It was staged with
index-level blob surgery instead, using a **temporary index file**
(`GIT_INDEX_FILE`) to preview the result before the real index was touched:

1. `git show HEAD:README.md` (LF blob) + only the two Practical 11 insertions
   (the Docker section and its Documentation link), all CR stripped →
   blob `c1e42c70d9da3abebc03718b295077fe327602b7`.
2. Preview in the temporary index: staged `36 / 0`, unstaged `159 / 1` ✅
3. Applied to the real index with `git update-index --add --cacheinfo`.

Result: the committed README contains **only** the Practical 11 additions,
while the pre-existing job-processing documentation remains **unstaged and
byte-identical** in the working tree (`git diff --numstat` → `159 1 README.md`).

### Exclusions verified after every commit

After each commit the staged set was checked to be exactly the intended paths,
and the following were confirmed **never staged**: `backend/package.json`,
`backend/.env.example`, `backend/server.js`,
`backend/src/controllers/authController.js`,
`backend/src/middleware/{errorHandler,logger}.js`,
`backend/src/routes/authRoutes.js`, `backend/src/services/emailService.js`,
all untracked `backend/src/{config,security,workers,models,controllers}` and
`backend/test/**` entries, `README.md`'s pre-existing 159 lines, `.env`,
`frontend/.env`, `GitHub token.txt`, `frontend/dist`, `practical files/`.

A secret scan over every file that was committed compared the real values from
`backend/.env` (`JWT_SECRET`, `JOB_PAYLOAD_ENCRYPTION_KEY`, `EMAIL_PASSWORD`,
`EMAIL_USER`, …) against the staged content: **no matches**. The one
`EMAIL_USER` string found in `Home.jsx` is a pre-existing contact address
already present in `HEAD` (verified against `git show HEAD:...Home.jsx`, one
occurrence before and after) and is not touched by commit 3.

## 5. Test results and limitations

| Check | Command | Result |
|---|---|---|
| Backend unit tests | `cd backend && npm test` | **138 / 138 pass**, fail 0, exit **0** |
| Frontend lint | `cd frontend && npm run lint` | exit **0** |
| Frontend production build | `cd frontend && npm run build` | exit **0**, `index-DNhM8H0g.js` 372.01 kB — **identical bundle hash to the pre-change baseline**, proving no behavioural change |
| Compose file validity | `docker compose config --quiet` | exit **0** |
| Live stack untouched | `docker compose ps` | `backend`, `frontend`, `mongodb` all **healthy** (up ~50 min throughout); volume `task-management_mongo_data` present |
| `git show --check` | run after every commit | exit **0** — no whitespace errors |
| Integration tests | `cd backend && npm run test:integration` | **exit 1 — BLOCKED (pre-existing guard refusal)** |

**Limitations**

1. `npm run test:integration` (20 tests) is blocked by the pre-existing
   `dbGuard` (`TestDatabaseNotApprovedError`): it requires
   `RUN_INTEGRATION_TESTS=1` plus an approved `*_test` `TEST_MONGO_URI`. The
   guard was **not** bypassed, so no integration test result is claimed.
2. Container runtime evidence (API flow, cache HIT/MISS, persistence across
   restart, CORS, security checks) is recorded in `docs/practical-11-audit.md`
   §G–§H from the original verification run. Those containers were deliberately
   **not** rebuilt or restarted during this commit pass, so no new runtime
   claims are made here; only `docker compose ps` / `config --quiet` (read-only)
   were used to confirm the stack and volume survived untouched.
3. `docker compose config` (full, non-quiet) is intentionally never captured in
   logs or docs because it expands `env_file` and prints resolved secrets.

## 6. Remaining uncommitted work (all pre-existing, all preserved)

After the Practical 11 commits the working tree contains **only** unrelated
work: **9 modified tracked files + 18 untracked entries** (`git stash list`
still empty, index empty).

```text
 M README.md                                     (159 pre-existing added lines + 1 deletion)
 M backend/.env.example          M backend/package.json
 M backend/server.js             M backend/src/controllers/authController.js
 M backend/src/middleware/errorHandler.js
 M backend/src/middleware/logger.js
 M backend/src/routes/authRoutes.js
 M backend/src/services/emailService.js

?? backend/src/config/jobConfig.js               ?? backend/src/controllers/debugController.js
?? backend/src/middleware/rateLimiter.js         ?? backend/src/models/jobModel.js
?? backend/src/security/                         ?? backend/src/services/jobService.js
?? backend/src/workers/                          ?? backend/test/controller.test.js
?? backend/test/dbGuard.test.js                  ?? backend/test/emailWorker.test.js
?? backend/test/encryption.test.js               ?? backend/test/helpers/
?? backend/test/integration/                     ?? backend/test/jobModel.test.js
?? backend/test/jobService.test.js               ?? backend/test/logging.test.js
?? backend/test/rateLimiter.test.js              ?? backend/test/regression.test.js
```

Baseline comparison: 9 modified + 18 untracked at the start of this pass →
**identical set at the end**. Nothing was added, removed, staged or lost.

## 7. Final branch and Git status

```text
$ git status -sb
## feature/practical-10-events...origin/feature/practical-10-events [ahead 5]

$ git log --oneline -6
<this file> docs: add Practical 11 commit audit report     <- hash not knowable inside itself
f2803a0   docs: document Practical 11 Docker setup and audit
f18e576   fix: correct frontend import path casing
9043117   feat: make frontend API base URL configurable at build time
3de5049   feat: add Dockerfiles and Compose orchestration
f9cffd9   docs: add Practical 10 commit audit report   <- previous HEAD
```

- Current branch: `feature/practical-10-events` (unchanged)
- HEAD: commit 5 (this report) — its own hash cannot appear inside itself
- Index: empty after every commit (`git diff --cached` → 0 entries)
- Stash: empty
- Docker: 3 services healthy, volume intact

## 8. Nothing was pushed — explicit confirmation

- **No `git push` of any kind was executed** (no `--force`, no ref deletion, no
  branch publication).
- No `git merge`, `git rebase`, `git reset`, `git checkout`, `git restore` or
  `git stash` was executed; no existing commit was amended.
- The only remote interaction was `git fetch origin` (read-only), which updated
  remote-tracking refs `origin/main` and left the feature branch's upstream at
  `f9cffd9`.
- Proof: `git log origin/feature/practical-10-events..HEAD` lists exactly the
  five local commits, and `git status -sb` reports `ahead 5` — the remote still
  points at `f9cffd9`.

## 9. Remote integration — separate decision, awaiting authorization

**Can `origin/main` be integrated safely? Yes.**

- `origin/main` (`e9bd728`) is a GitHub PR merge of this exact feature branch;
  its tree is **byte-identical** to `f9cffd9` (§2), so integrating it changes
  **no file content**.
- A read-only in-memory merge test (`git merge-tree --write-tree HEAD
  origin/main`) completed with **exit 0 and no conflicts**, without touching the
  index, the working tree or any ref.
- Therefore it **cannot** conflict with the 9 modified files / 18 untracked
  entries that must be preserved, nor with the Docker commits.

**Not yet done on purpose:** a `git merge origin/main` would *not* be a
fast-forward from the current HEAD (the merge base is `f9cffd9`, and both sides
have diverged), so it would create a merge commit; and rebasing would rewrite the
five local commits. Both are integration decisions that were explicitly left to
the repository owner.

**Recommended next step (requires explicit authorization):**

1. Publish nothing until told to; nothing is at risk meanwhile.
2. When authorized, the cleanest option is to push the feature branch
   (`git push origin feature/practical-10-events` — a normal fast-forward, no
   force needed) and let GitHub merge it: `main` already contains `f9cffd9`, and
   the five new commits touch only files `main` does not have (plus the README
   hunk), so the PR merge is conflict-free.
3. Alternatively, integrate `origin/main` locally with
   `git merge origin/main` (creates one merge commit, no content change, proven
   conflict-free above) — but only on request.
4. Local `main` is 5 behind `origin/main` and can be fast-forwarded separately
   (`git fetch . origin/main:main` or a checkout + `--ff-only`) — again, only on
   request.
5. The 9 modified / 18 untracked pre-existing changes must be committed by their
   owner, separately, and never as part of a Practical 11 commit.

## 10. Safety rules observed

- Smallest possible changes; no architecture, route, controller, middleware,
  test or database change — MongoDB remains the only database.
- No Kubernetes, Redis, message broker or dependency upgrade.
- No commit, push, merge, rebase, amend or destructive git command; no history
  rewrite; no force push.
- No `.env`, secret, token, credential file, database data or generated
  artifact staged or committed; `backend/.env` remains required only at runtime
  via `env_file`.
- No unverified claim: every result above was executed in this session, and the
  blocked integration suite is reported as blocked rather than passed.
