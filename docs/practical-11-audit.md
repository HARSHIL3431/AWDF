# Practical 11 — Docker Containerization Audit

**Status vocabulary:** PASS · PARTIAL · FAIL · BLOCKED · NOT APPLICABLE
**Repository:** `C:\Users\Admin\Desktop\sem 5\webdev`
**Date:** 2026-10-25
**Docker:** 29.2.1 (Docker Desktop, Linux engine) · **Compose:** v5.1.0

---

## A. Executive summary

**Practical 11 is COMPLETE.**

The React frontend, Node/Express backend and MongoDB now run together from the
repository root with the single documented command `docker compose up --build`,
on a user-defined bridge network (`app-network`), with published host ports
5173/5000/27017 and MongoDB data in a named volume that survives container
recreation.

Everything was **built, started and exercised live on this machine** — image
builds, health-gated startup, frontend HTML/assets, backend API (auth, task
CRUD, Practical 9 cache hit + invalidation, Practical 10 task-created and
task-deleted notifications), a full `docker compose down` → `up --build`
persistence round trip, secret scans of images and logs, and the unchanged host
test suites (backend 138/138, frontend lint + build).

Two honest deviations are recorded below and none of them weaken the
application:

1. **Four frontend source files had to change** (§C): eleven imports used
   `../components/` while the real directory is `src/Components/` — invisible on
   Windows, fatal on Linux — plus making the backend base URL a `VITE_API_URL`
   build arg whose default is the pre-existing value.
2. **`docker compose config --quiet` must be used for validation**, because the
   *full* rendered output expands `env_file` and would print resolved secrets
   (§H).

Implementation and verification were completed first, with no commit at all.
The Practical 11 commits were prepared afterwards in a separate, explicitly
authorized pass — see §J and `docs/practical-11-commit-audit.md`. No push, no
merge and no history rewrite was performed, and every pre-existing uncommitted
change remains untouched in the working tree.

---

## B. Repository baseline

| Item | Value |
|---|---|
| Branch | `feature/practical-10-events` (no upstream configured) |
| Initial HEAD | `f9cffd94092257a48e83a7b43fb98a7fcb89cbc1` — *docs: add Practical 10 commit audit report* |
| HEAD while implementing/verifying | **identical** (`f9cffd9…`) — nothing was committed during implementation |
| HEAD after the commit pass | the path-scoped Practical 11 commits listed in §J — **never pushed** |
| Staged changes | none at start; each commit staged only its own paths, index empty afterwards |
| Initial working tree | 9 modified tracked files + 18 untracked entries (all pre-existing job-processing / encryption / rate-limiter / logging / auth / email / test work) |
| Working tree while implementing | 13 modified + 25 untracked (26 with this file) — the same pre-existing set, plus the Practical 11 changes in §C |
| Working tree after the commit pass | back to the 9 pre-existing modified files + 18 pre-existing untracked backend entries + `README.md`'s 159 unstaged pre-existing lines — i.e. only unrelated work remains uncommitted (exact counts in `docs/practical-11-commit-audit.md`) |

### Baseline measurements (before any edit)

| Check | Result |
|---|---|
| `cd backend && npm test` | **138 pass / 0 fail** (2.8 s) |
| `cd backend && npm run test:integration` | **BLOCKED** — 20 tests, all `TestDatabaseNotApprovedError` refusals (pre-existing guard, not bypassed) |
| `cd frontend && npm run lint` | exit 0, no problems |
| `cd frontend && npm run build` | ✓ built (bundle `index-DNhM8H0g.js`, 372.01 kB) |
| Framework | **Vite 8 + React 19** (`vite`, `@vitejs/plugin-react`, `react-router-dom` 7) — confirmed from `frontend/package.json`, not assumed |
| Module system | **ES modules** (`"type": "module"`) — preserved in both Dockerfiles |
| Backend port / entry | `config.port` = `PORT \|\| 5000`, start command `node server.js` |
| Mongo config | `MONGO_URI` env var, default `mongodb://localhost:27017/task_manager` |
| Existing Docker files | **none** (no Dockerfile, Compose file or `.dockerignore` anywhere) |
| Pre-existing uncommitted work identified | `backend/{.env.example,package.json,server.js}`, `backend/src/controllers/authController.js`, `backend/src/middleware/{errorHandler,logger}.js`, `backend/src/routes/authRoutes.js`, `backend/src/services/emailService.js`, `README.md` (~159 pre-existing added lines), 18 untracked backend entries |
| Docker availability | CLI installed; **daemon was stopped** → started Docker Desktop (already-installed software, nothing installed or modified system-wide), then verified `docker info` → `ServerVersion=29.2.1 OS=linux` |
| Host ports 5000/5173/27017 | free before mapping |
| Existing containers/volumes/networks | none — nothing unrelated was touched |

---

## C. Files changed

### Added by Practical 11 (8)

| File | Purpose |
|---|---|
| `backend/Dockerfile` | Node 24 slim image, manifest-first `npm ci --omit=dev`, `CMD ["node","server.js"]`, `EXPOSE 5000`, non-root |
| `backend/.dockerignore` | excludes `node_modules`, `.env*` (keeps `.env.example`), `.git`, logs, coverage, tests |
| `frontend/Dockerfile` | multi-stage `npm ci` + `vite build` → `vite preview --host 0.0.0.0 --port 5173 --strictPort`, `--chown=node:node` |
| `frontend/.dockerignore` | excludes `node_modules`, `dist`, `.env*` (keeps template), logs |
| `.dockerignore` | root-context rules (incl. local `practical files/`, `GitHub token.txt`) |
| `docker-compose.yml` | services `frontend`, `backend`, `mongodb`; network `app-network`; volume `mongo_data`; health checks + `condition: service_healthy` |
| `docs/practical-11-docker.md` | the 18 required documentation topics + recorded results |
| `docs/practical-11-audit.md` | this report |

### Modified by Practical 11 (4 frontend files, no backend source touched)

| File | Change | Diff |
|---|---|---|
| `frontend/src/services/authService.js` | `API_URL = import.meta.env.VITE_API_URL \|\| 'http://localhost:5000'` (+ comment) | +6 / −1 |
| `frontend/src/services/taskService.js` | same treatment for the `/tasks` base URL | +2 / −1 |
| `frontend/src/pages/Home.jsx` | 4 import specifiers `../components/` → `../Components/` | 4 / 4 |
| `frontend/src/pages/Projects.jsx` | 7 import specifiers `../components/` → `../Components/` | 7 / 7 |

### Modified file containing BOTH Practical 11 and pre-existing work

| File | Practical 11 lines | Pre-existing lines | Verdict |
|---|---|---|---|
| `README.md` | **+36** (new *Docker (Practical 11)* section, lines 165–199, and one Documentation entry) | +159 / −1 (job-processing, rate-limiting and integration-test documentation written before this practical) | **mixed — must be staged partially or left uncommitted** (see §J) |

### Deliberately NOT touched

All eight pre-existing modified backend files, all 18 untracked backend
entries (job/encryption/rate-limiter/logging/security/workers and their tests),
`backend/package.json`, `backend/.env.example`, `frontend/.env`,
`frontend/dist`, and every Practical 1–10 source/test file outside the four
frontend files above. **No backend source file was modified at all.**

---

## D. Requirements compliance matrix

| # | Requirement | Status | Evidence | Remaining action |
|---|---|---|---|---|
| 1 | Inspect repo; determine framework/module system; don't assume Vite | **PASS** | `frontend/package.json` → Vite 8/React 19; `backend/package.json` → `"type":"module"`; no Docker files existed | — |
| 2 | Establish baseline before editing | **PASS** | §B table: 138/138, lint 0, build ✓, integration BLOCKED, `git diff`/`git status` captured | — |
| 3 | Verify Docker availability; record blocker if absent | **PASS** | `docker --version` 29.2.1, `docker compose version` v5.1.0; daemon was stopped → started Docker Desktop, `docker info` → linux/x86_64 | — |
| 4 | Backend Dockerfile: official Node ≥18, workdir, manifests first, `npm ci` + lockfile, no host `node_modules`, no `.env`/secrets/git, expose 5000, correct entry point, listens on 0.0.0.0, preserve startup | **PASS** | `backend/Dockerfile`; image `/app` = `node_modules package-lock.json package.json server.js src` only; `find /app -name '.env*'` → nothing; host reaches `localhost:5000` (Docker publishes to the container's non-loopback IP, so a `127.0.0.1`-only bind could not work); log `Server running in development mode on port 5000` | — |
| 5 | Frontend Dockerfile: multi-stage, real build command, preview on 0.0.0.0, no host `node_modules`, no `.env` | **PASS** | `frontend/Dockerfile`; build log `vite build` inside image; container log `Local: http://localhost:5173/` + `Network: http://172.18.0.4:5173/`; runtime `/app` has `dist` + `node_modules`, no `.env`, no `src` | — |
| 6 | `.dockerignore` (root/…/backend), exclude `node_modules`, `.env`, `.env.*`, `.git`, `npm-debug.log*`, `coverage`, keep `.env.example`, nothing required excluded | **PASS** | three files, all use `!.env.example`; builds succeeded, so no required file was excluded | — |
| 7 | Compose file at root with exactly `frontend`, `backend`, `mongodb` | **PASS** | `docker compose config --quiet` exit 0; three services only | — |
| 8 | Named bridge network `app-network`, all services attached | **PASS** | `networks: {app-network: {name: app-network, driver: bridge}}`; `docker network ls` shows `app-network` while running | — |
| 9 | Frontend: build from `./frontend`, host↔container port correct, depends on backend, API URL configured for browser | **PASS** | `ports: 5173:5173`, `depends_on: backend: service_healthy`, `VITE_API_URL` build arg (default `http://localhost:5000`) baked into served bundle | — |
| 10 | Backend: build from `./backend`, host 5000, Mongo via Compose hostname, runtime env, never `localhost`, health check + dependency condition | **PASS** | `MONGO_URI: mongodb://mongodb:27017/task_manager`; log `MongoDB connected`; mongo connections observed from `172.18.0.3`; healthcheck = `node fetch(...)`; `depends_on: mongodb: service_healthy` | — |
| 11 | MongoDB: official image with explicit version, host port if free, named volume, health check, no host DB files mounted, data preserved, never `down -v` | **PASS** | `mongo:7.0` (pinned); `27017:27017` (port was free); `mongo_data:/data/db`; `mongosh --eval "db.adminCommand('ping')"`; no bind mounts; persistence proven in §F; `down -v` never used | — |
| 12 | `depends_on` alone is insufficient → readiness handled | **PASS** | health checks + `condition: service_healthy`; startup log shows `mongodb Healthy → backend Healthy → frontend Starting` | — |
| 13 | Single command `docker compose up --build`, no manual steps between services | **PASS** | executed repeatedly; one documented prerequisite (`backend/.env`) identical to the project's existing local setup | — |
| 14 | No scripts that silently delete volumes | **PASS** | no script added; `down -v` documented only as destructive/never-used | — |
| 15 | Safe env template; no committed `.env`; DB string configurable; reuse `MONGO_URI`; preserve JWT/email/auth; no fake production-ready credentials; no server secrets to frontend; local dev unbroken | **PASS** | `env_file: ./backend/.env` + only `MONGO_URI`/`PORT` overridden; `backend/.env.example` unchanged; no secret literals in `docker-compose.yml`; only `VITE_API_URL` (a URL) reaches the frontend build; `npm test`/lint/build unaffected | — |
| 16 | Frontend→backend connectivity strategy correct for browser; `backend` hostname not resolvable from browser; preserve routes/auth headers/response handling | **PASS** | browser-visible URL approach; served bundle contains `http://localhost:5000`; host:5000 answers; `GET /tasks` with `Authorization: Bearer` → 200 | — |
| 17 | CORS not weakened; no auth changes | **PASS** | **no backend file modified**; `Origin: http://localhost:5173` request → `Access-Control-Allow-Origin: *`, allowed headers `Content-Type, Authorization`; `OPTIONS /login` → 200 with `ACAM: GET, POST, PUT, DELETE, OPTIONS` | — |
| 18 | Preserve task CRUD | **PASS** | register 201, login 200, create 201, list 200, read 200, delete 200, read-after-delete 404 | — |
| 19 | Preserve authentication/authorization | **PASS** | `/debug/cache-stats` and `/tasks` without token → **401**; with token → 200 | — |
| 20 | Preserve MongoDB persistence | **PASS** | task survived `down` → `up --build` (§F) | — |
| 21 | Preserve Practical 9 caching + invalidation + statistics | **PASS** | in-container: 1st list MISS / 2nd list HIT (`hits +1, misses +1`), `DELETE` then list → MISS again; `/debug/cache-stats` returns `{hits,misses,totalRequests,hitRate}` | — |
| 22 | Preserve Practical 10 task-created/task-deleted events, async notification + error handling | **PASS** | container logs: `Task-created handler started … completed (2005 ms later)` and `Task-deleted handler started/…/completed`; emitted after the 201 response | — |
| 23 | Preserve email/job/security/rate-limiter/logging functionality where relevant | **PASS** | backend container log: `[worker] email worker started (poll 2000ms, batch 5, lease 120000ms)`; `NODE_ENV`, `FRONTEND_URL`, SMTP vars passed through unchanged | — |
| 24 | Don't change business logic for containerization | **PASS** | only import-path case correction + a build-time-configurable URL with the old default; backend untouched; host lint/build still pass with an identical bundle hash | — |
| 25 | `docker compose config` valid, no unintentional secret exposure | **PARTIAL** | `--quiet` → exit 0 (valid, no output). Full `docker compose config` **does** expand `env_file` (prints `JWT_SECRET`, 64-hex encryption key, `EMAIL_PASSWORD`) — detected and recorded | Always validate with `--quiet`; never paste the full rendered config |
| 26 | Build images | **PASS** | `docker compose build` → `task-management-backend:latest`, `task-management-frontend:latest`, exit 0 (first attempt exposed the import-case bug, fixed, rebuilt) | — |
| 27 | Three services running + backend connected to Mongo | **PASS** | `docker compose ps` → all three `healthy`; log `MongoDB connected` | — |
| 28 | Frontend page loads; API requests reach backend | **PASS** | `GET /` → 200 with `<div id="root">`; SPA deep links `/tasks`, `/projects/HARSHIL3431` → 200 HTML; served asset 372 018 bytes contains the API URL; CORS preflight + real API calls from the frontend origin succeed | Optional: a human visual check in a browser (verification here was HTTP-level) |
| 29 | Safe test operations; dedicated test account; don't alter existing data | **PASS** | only `docker_test_*` / `docker_cache_*` accounts used; final DB: `0 probe docs; 0 total tasks`; 2 inert accounts remain (no user-deletion endpoint exists) | Optionally delete the two test accounts manually |
| 30 | Persistence across container restart without volume deletion | **PASS** | §F: task present before `down`, still present (200, same title) after `up --build` | — |
| 31 | Service-name resolution, readiness ordering, no credentials in logs | **PASS** | backend→`mongodb` DNS works; health-gated order; scan of all logs: `JWT_SECRET`/encryption key/SMTP credentials/Atlas URI absent, marker scan → 0 | — |
| 32 | Regression tests before and after | **PASS** | backend **138/138** after all changes; frontend lint exit 0; build ✓ identical hash | — |
| 33 | Integration suite | **BLOCKED** | `TestDatabaseNotApprovedError` refusals — identical to baseline; guard **not** bypassed, no production DB used | Configure and approve an isolated `*_test` database, then `RUN_INTEGRATION_TESTS=1 npm run test:integration` |
| 34 | Backend lint/type-check | **NOT APPLICABLE** | no such script exists in `backend/package.json` | — |
| 35 | Documentation updated additively; `docs/practical-11-docker.md` covers all 18 topics; startup command documented as `docker compose up --build` | **PASS** | README gained 36 lines, removed nothing; doc covers topics 1–18 incl. `EXPOSE` vs `ports`, host `node_modules`, named volumes | — |
| 36 | `docs/practical-11-audit.md` with A–J and this vocabulary | **PASS** | this file | — |
| 37 | Git safety: no destructive commands, commit only when explicitly authorized, preserve unrelated work, review the final diff | **PASS** | implementation was fully verified *before* any commit; the path-scoped commits in §J were created only under explicit authorization and each was inspected with `git show --check` + `git show --stat`; nothing pushed, merged or rewritten; no `reset --hard`/`clean`/`checkout`/`stash`; every pre-existing change left uncommitted and byte-identical to baseline | — |
| 38 | Never claim execution that didn't happen | **PASS** | every command in §E/§F was executed; blocked checks reported as blocked | — |

---

## E. Build and test results (actual commands)

| Command | Result |
|---|---|
| `docker compose config --quiet` | exit **0** (valid; no output, no secrets printed) |
| `docker compose build` (1st) | **FAILED** — 11 × `UNRESOLVED_IMPORT ../components/…` (case-sensitivity bug in existing source) |
| `docker compose build` (after fix) | **exit 0** — both images built |
| `docker compose up --build` | **3 services started**, health-gated order observed |
| `docker compose up -d` (after adding frontend healthcheck) | mongodb `Healthy` → backend `Healthy` → frontend `Started` |
| `docker compose ps` | `backend healthy`, `frontend healthy`, `mongodb healthy` |
| `cd backend && npm test` (after all changes) | **138 pass / 0 fail** |
| `cd backend && npm run test:integration` | **BLOCKED** — `TestDatabaseNotApprovedError` (unchanged, not bypassed) |
| `cd frontend && npm run lint` | exit **0**, no problems |
| `cd frontend && npm run build` | **✓ built in 809 ms**, bundle hash `index-DNhM8H0g.js` unchanged from baseline |
| Frontend Docker build (`npm ci` + `vite build` inside image) | success (11 modules… `441 modules transformed`, bundle 372.01 kB) |

**Docker not required for:** the host test suites above; they were run
independently to prove containerization introduced no regression.

---

## F. Runtime evidence

### F.1 Service status

```text
SERVICE    STATUS                        PORTS
backend    Up 4 minutes (healthy)        0.0.0.0:5000->5000/tcp
frontend   Up 31 seconds (healthy)       0.0.0.0:5173->5173/tcp
mongodb    Up 4 minutes (healthy)        0.0.0.0:27017->27017/tcp
```

### F.2 Backend startup (service-name connectivity)

```text
Server running in development mode on port 5000 - 2026-10-25T15:02:01Z
MongoDB connected
[worker] email worker started (poll 2000ms, batch 5, lease 120000ms)
```

MongoDB accepted connections from `172.18.0.3` (the backend container on
`app-network`) — i.e. `mongodb` resolved through Compose DNS, not `localhost`.

### F.3 Frontend (host browser perspective)

```text
GET http://localhost:5173/                    -> 200 (853 bytes, <div id="root">)
GET http://localhost:5173/tasks               -> 200 text/html (SPA fallback)
GET http://localhost:5173/projects/HARSHIL3431-> 200
GET http://localhost:5173/assets/index-BrN_1fWK.js -> 200 (372018 bytes)
   served bundle contains "http://localhost:5000"  -> true
```

### F.4 API contract (host → container)

```text
GET  /debug/cache-stats            (no token) -> 401
POST /register                     -> 201
POST /login                        -> 200 (JWT)
POST /tasks                        -> 201
GET  /tasks (1st / 2nd)            -> 200 / 200
   cache stats                     -> {"hits":1,"misses":1,"totalRequests":2,"hitRate":50}
GET  /tasks/:id                    -> 200
DELETE /tasks/:id                  -> 200
GET  /tasks/:id (after delete)     -> 404
GET  / (host)                      -> 404 JSON  (server reachable on host:5000)
```

CORS as the browser will see it (unchanged backend conventions):

```text
Origin: http://localhost:5173  GET /debug/cache-stats -> 401
   Access-Control-Allow-Origin: *
   Access-Control-Allow-Headers: Content-Type, Authorization
OPTIONS /login (preflight)                    -> 200
   ACAO: * | ACAH: Content-Type, Authorization | ACAM: GET, POST, PUT, DELETE, OPTIONS
```

### F.5 Practical 10 inside the container

```text
[API] POST /tasks response initiation at 2026-10-25T15:13:21.516Z (status 201)
[Notification] Task-created handler started at 2026-10-25T15:13:21.517Z
[Notification] Task "cache invalidation probe" has no assigned user ...
[Notification] Task-created handler completed at ... (2005 ms later)
[Notification] Task-deleted handler started at 2026-10-25T15:08:42.067Z
[Notification] Task "…" (taskId=6ade1aa5…) deleted by 6ade1aa5…
[Notification] Task-deleted handler completed at 2026-10-25T15:08:42.067Z
```

### F.6 Practical 9 cache HIT + invalidation inside the container

```text
baseline stats -> {"hits":4,"misses":6,...}
create -> 201 id=6ade1d2535cb6e4e2cd40ee5
after 2 lists  -> {"hits":5,"misses":7,...} (hits +1, misses +1)  1st MISS, 2nd HIT
delete -> 200; list after DELETE -> {"hits":5,"misses":8,...} => MISS (invalidated) OK
RESULT: PASS (auth + cache HIT + invalidation all behave in the container)   exit=0
```

### F.7 Persistence across container recreation

```text
1. POST /tasks -> 201, id 6ade1aa54069a25278de25f1
2. docker compose down            -> containers + network removed
   docker volume ls               -> task-management_mongo_data   (KEPT)
3. docker compose up --build      -> fresh containers
4. GET /tasks/6ade1aa54069a25278de25f1 -> 200
   title = "Practical 11 docker persistence probe"
   GET /tasks (no token)          -> 401
   DELETE                         -> 200 (cleanup)
   GET  after delete              -> 404
final DB state: 0 probe docs; 0 total tasks
```

### F.8 Log safety

Scanned every container log line against the actual values in `backend/.env`:
`JWT_SECRET`, `JOB_PAYLOAD_ENCRYPTION_KEY`, `EMAIL_PASSWORD`, `EMAIL_USER`,
`MONGO_URI` → **absent**; `.mongodb.net` (Atlas host) → absent; marker scan
(`mongodb+srv`, `Bearer <token>`, `password=`, `JWT_SECRET`) → **0 matches**.

### F.9 Graceful shutdown

```text
SIGTERM received, starting graceful shutdown
[worker] stopped (drained=true)
Shutdown complete
backend-1 exited with code 0
```

---

## G. Preservation and regression audit

**No backend source file was modified.** Every route, controller, middleware,
model, service, worker and test from Practicals 1–10 is byte-identical to the
baseline; only Docker files and four frontend files were touched.

| Area | How preserved | Verified by |
|---|---|---|
| Task CRUD & response contracts | untouched code, same port, same routes | status codes 201/200/404 in §F.4 |
| Auth / authorization | untouched middleware; CORS untouched | 401s without token; 200 with token |
| MongoDB (not replaced) | same `MONGO_URI` variable name, same `task_manager` database name, container value = service DNS | `MongoDB connected`, persistence round trip |
| Practical 9 caching | untouched cache service | hit/miss deltas + invalidation in §F.6; `/debug/cache-stats` still auth-gated |
| Practical 10 events | untouched emitter/listeners/controller emits; still registered once at startup | §F.5 logs, 2005 ms async handler |
| Email worker / job queue / encryption | untouched; vars passed through `env_file` | `[worker] email worker started …` |
| Rate limiting, logging, redaction | untouched | logs contain no secrets; request log lines unchanged |
| Local development | `backend/.env` unchanged; `MONGO_URI`/`PORT` overrides apply only inside containers; frontend default `http://localhost:5000` unchanged | host `npm test` 138/138, lint 0, build identical hash |
| Tests | none weakened or deleted | 138 pass / 0 fail after all changes |

The only application-code changes are the 11 import-specifier case corrections
(required for *any* Linux build; behaviour-identical on Windows) and the
build-time-configurable API base URL whose default equals the previous literal.

---

## H. Security audit

| Check | Result |
|---|---|
| Real `.env` excluded from every build context | **PASS** — `backend/.dockerignore` + `frontend/.dockerignore` + root all list `.env`/`.env.*`; `.env.example` preserved via `!.env.example` |
| No `.env` inside either image | **PASS** — `find /app -name '.env*'` → nothing in both images |
| Image contents minimal | **PASS** — backend: `node_modules package-lock.json package.json server.js src` (no `test/`, no scripts, no Git); frontend: `dist index.html node_modules package*.json vite.config.js` (no `src/`) |
| No secrets in `docker-compose.yml` / Dockerfiles | **PASS** — no credential literal; only URLs and port numbers; values come from the git-ignored `env_file` at runtime |
| No secrets in logs | **PASS** — §F.8 scan |
| No secrets in Git | **PASS** — nothing staged or committed; `.env` and `GitHub token.txt` are git-ignored and Docker-ignored |
| Frontend build receives no server secrets | **PASS** — only `VITE_API_URL` (a public URL) is passed as a build arg |
| GitHub token not baked into the frontend image | **PASS** — `frontend/.env` is excluded from the context (consequence recorded in §I.6) |
| Containers run as non-root | **PASS** — `USER node` in both Dockerfiles; `--chown=node:node` keeps the frontend writable |
| Production dependency install | **PASS** — backend `npm ci --omit=dev` (nodemon excluded) |
| Rendered-config output can leak secrets | **PARTIAL** — full `docker compose config` expands `env_file` and prints `JWT_SECRET`, the 64-hex key and `EMAIL_PASSWORD`. Mitigation: validate with `docker compose config --quiet`; never paste full output |
| MongoDB published on host 27017 without auth | **PARTIAL** — matches the project's existing no-auth setup and is convenient for inspection, but is only appropriate on a trusted machine; remove that `ports:` mapping for anything exposed |
| CORS / authentication weakened for containers | **PASS** — no backend change; existing `*` CORS and Bearer auth verified unchanged |

---

## I. Known limitations

1. **`backend/.env` must exist** before `docker compose up --build` (same as
   local development). Without it Compose fails fast; without
   `JOB_PAYLOAD_ENCRYPTION_KEY` the backend exits with code 1 before listening
   — deliberate pre-existing fail-fast behaviour, and its message never prints
   the key.
2. **Integration tests remain BLOCKED** by the pre-existing database guard
   (`RUN_INTEGRATION_TESTS=1` + an approved `*_test` URI). Identical before and
   after Practical 11; not bypassed; no production or dev database substituted.
3. **Frontend image is 460 MB** (backend 368 MB, `mongo:7.0` 1.18 GB): preview
   must load `vite.config.js`, which imports `@vitejs/plugin-react`, so the
   runtime stage carries the dependency tree — copied from the build stage,
   never from the host. Nginx would shrink this to ~50 MB at the cost of
   deviating from the lab's Vite-preview example.
4. **`vite preview` is development-grade** (no compression/caching/TLS
   hardening) and plain HTTP is used throughout — acceptable for the lab, not
   for production.
5. **GitHub statistics are unauthenticated in containers**, because
   `frontend/.env` (real `VITE_GITHUB_TOKEN`) is intentionally kept out of the
   build context; the UI's existing rate-limit error path handles this.
6. **No GUI browser session was automated** — frontend verification was done
   over HTTP (HTML/assets/deep links/CORS/API), which is what the browser
   performs, but a human visual pass is still worthwhile.
7. **`docker compose config` (full) reveals resolved secrets** — see §H.
8. **Standalone MongoDB / single backend instance** — no replica set,
   orchestration, TLS or horizontal scaling (Kubernetes/Redis deliberately not
   introduced).
9. **Two inert test accounts** (`docker_test_…`, `docker_cache_…`) remain in the
   database; the API exposes no user-deletion endpoint. All created task
   documents were deleted (`0 total tasks`).
10. **The local image store also lists `mongo:latest`**, which this practical
    neither references (Compose pins `mongo:7.0`) nor pulled or ran.
11. **Windows/Linux case-sensitivity gap** required fixing 11 existing import
    specifiers — any future case-mismatched import will again break only inside
    containers. A repository-wide check confirmed no other mismatch remains.

---

## J. Commits prepared

Implementation and verification ran with **no commit at all**; afterwards, in a
separate explicitly authorized pass, the Practical 11 work was split into small,
independently reviewable commits (path-scoped staging only — never `git add .`
or `-A`). The earlier single-message recommendation
(`feat: containerize task management stack with Docker Compose`) was superseded
by this split:

| # | Message | Files committed |
|---|---------|-----------------|
| 1 | `feat: add Dockerfiles and Compose orchestration` | `docker-compose.yml`, `.dockerignore`, `backend/Dockerfile`, `backend/.dockerignore`, `frontend/Dockerfile`, `frontend/.dockerignore` |
| 2 | `feat: make frontend API base URL configurable at build time` | `frontend/src/services/authService.js`, `frontend/src/services/taskService.js` |
| 3 | `fix: correct frontend import path casing` | `frontend/src/pages/Home.jsx`, `frontend/src/pages/Projects.jsx` |
| 4 | `docs: document Practical 11 Docker setup and audit` | `docs/practical-11-docker.md`, `docs/practical-11-audit.md`, `README.md` (36 lines only) |
| 5 | `docs: add Practical 11 commit audit report` | `docs/practical-11-commit-audit.md` |

Hashes, the per-commit `git show --check` / `git show --stat` evidence and the
full before/after repository status are recorded in
`docs/practical-11-commit-audit.md`.

Commit 2 is deliberately separate: it changes *application source* that consumes
the Dockerfile's `VITE_API_URL` build arg, so folding it into commit 1 would
hide an app-code change inside an infrastructure commit, and adding it to
commit 3 would break that commit's promise of containing nothing but
import-path case fixes.

⚠️ **`README.md` was staged partially** (index-level blob staging, the same
technique used for Practicals 10): only its 36 Practical 11 lines are committed.
The ~159 pre-existing added lines from the unfinished
job-processing/encryption/rate-limiter documentation (plus their single
deletion) remain unstaged for the owner of that work.

Nothing was pushed, merged or rewritten. Still uncommitted, do **not** stage:
`backend/package.json`, `backend/.env.example`,
`backend/server.js`, `backend/src/controllers/authController.js`,
`backend/src/middleware/{errorHandler,logger}.js`,
`backend/src/routes/authRoutes.js`, `backend/src/services/emailService.js`,
any untracked `backend/src/{config,security,workers,models,controllers}` or
`backend/test/**` entry — all pre-existing, unrelated work.

Never stage `.env`, `frontend/.env`, `GitHub token.txt`, `node_modules`,
`frontend/dist`, or anything under `practical files/`.
