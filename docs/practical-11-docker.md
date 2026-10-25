# Practical 11 — Docker Containerization & Docker Compose

**Project:** Task Management (React + Express + MongoDB), Practicals 1–10 preserved
**Date:** 2026-10-25
**Startup command:**

```bash
docker compose up --build
```

This document describes what was actually built and, where marked, what was
actually executed on this machine. Nothing below is aspirational: see
§14 for the recorded build/runtime results and §15 for the limitations.

---

## 1. Architecture and service topology

Three containers, one user-defined bridge network, browser-visible port
mappings:

```text
                    Host machine
   ┌──────────────────────────────────────────────────────────┐
   │  Browser ──► http://localhost:5173 (host port 5173)      │
   │          └─► http://localhost:5000 (host port 5000)      │
   └───────────────┬───────────────────────┬──────────────────┘
                   │ port publish          │ port publish
   ┌───────────────▼──────────┐  ┌─────────▼─────────────────┐
   │ frontend container       │  │ backend container         │
   │ vite preview (node 24)   │  │ Express + Mongoose (n24)  │
   │ listens 0.0.0.0:5173     │  │ listens :5000             │
   └──────────────────────────┘  └─────────┬─────────────────┘
                     app-network (bridge)  │ service DNS: mongodb:27017
                                   ┌───────▼─────────────────┐
                                   │ mongodb container       │
                                   │ mongo:7.0               │
                                   │ volume: mongo_data      │
                                   └─────────────────────────┘
```

Important: **the frontend container never talks to the backend container.**
The React bundle runs in the user's browser, so API calls leave the browser and
hit the host-published backend port (see §Frontend→backend connectivity).

## 2. Required setup

- Docker Desktop (Windows/macOS) or Docker Engine + the Compose plugin
  (`docker compose`, not the legacy `docker-compose`).
- This machine: Docker **29.2.1** + Compose **v5.1.0** (verified).
- `backend/.env` must exist — identical to the prerequisite the project already
  has for local development. Create it once if missing:

```bash
cp backend/.env.example backend/.env   # then fill JWT_SECRET, JOB_PAYLOAD_ENCRYPTION_KEY, ...
```

Nothing else is needed between starting the services: no manual seeding, no
second terminal, no extra script.

## 3. Dockerfile locations

| File            | Role                                                     |
|-----------------|----------------------------------------------------------|
| `backend/Dockerfile`  | Node 24 slim, `npm ci --omit=dev`, `CMD ["node","server.js"]` |
| `frontend/Dockerfile` | Multi-stage: `npm ci` + `vite build` → `vite preview`     |
| `docker-compose.yml`  | Root Compose file: `frontend`, `backend`, `mongodb`       |
| `.dockerignore`, `backend/.dockerignore`, `frontend/.dockerignore` | Build-context exclusions |

Both images use **`node:24-slim`**: the project is developed on Node 24.12, and
it satisfies every dependency's `engines` (Vite `^20.19 || >=22.12`,
Mongoose `>=20.19`). The `-slim` Debian variant keeps glibc, avoiding musl
native-binary issues for esbuild/rollup/rolldown.

## 4. Compose service names and ports

| Service    | Image / build      | Container port | Host port | Purpose                              |
|------------|--------------------|----------------|-----------|--------------------------------------|
| `frontend` | `./frontend` build | 5173           | **5173**  | `vite preview` serving `dist/`        |
| `backend`  | `./backend` build  | 5000           | **5000**  | REST API (`PORT=5000`)                |
| `mongodb`  | `mongo:7.0`        | 27017          | **27017** | Database, host access for inspection  |

`vite preview` is launched with `--host 0.0.0.0 --port 5173 --strictPort`:
without `--host` it would bind `127.0.0.1` *inside* the container and the host
browser could never reach it; `--strictPort` makes a port clash fail loudly
instead of silently moving to another port.

Ports were confirmed free on the host before mapping (`Get-NetTCPConnection`
showed nothing listening on 5000/5173/27017).

## 5. Network configuration

```yaml
networks:
  app-network:
    name: app-network
    driver: bridge
```

All three services join `app-network`; `name:` pins the real Docker network
name to **`app-network`** as the practical requires (otherwise Compose would
prefix it with the project name). Inside this network each service is reachable
by its service name: `frontend`, `backend`, `mongodb`.

## 6. MongoDB connection string

Inside the backend container:

```text
MONGO_URI=mongodb://mongodb:27017/task_manager
```

- **`mongodb` is the Compose service name**, which Docker's embedded DNS
  resolves to that container's IP on `app-network`. This is why `localhost`
  must never be used here: inside the backend container `localhost` means the
  backend container itself, which has no mongod.
- `task_manager` is the same database name the project already uses
  (`config.mongoUri` default is `mongodb://localhost:27017/task_manager`), so
  local development and containerized development use equivalent database names.
- No credentials are embedded in the URI: the MongoDB container runs without
  authentication (standalone, bound to the host's `27017` for local access
  only), matching the project's existing configuration.
- The backend's **host** `.env` may contain an Atlas URI; Compose's
  `environment:` block overrides `MONGO_URI` for the container (Compose
  precedence: `environment` > `env_file`), so the container always uses the
  local Compose database.

## 7. Persistent named volume

```yaml
volumes:
  mongo_data:          # named volume
services:
  mongodb:
    volumes:
      - mongo_data:/data/db
```

Data lives in Docker-managed storage (`task-management_mongo_data`), **not** in
the container's writable layer and **not** on a host path bind-mount. The
containers can be stopped, removed and rebuilt while the data survives —
verified in §13/§14. Only `docker compose down -v` deletes it, and that command
is never part of setup or verification.

## 8. `.dockerignore` configuration

Each build context has its own ignore file (`frontend/` and `backend/` are the
two actual contexts; a root file is provided for safety):

```text
node_modules          # never ship host dependencies
.env / .env.*         # never ship local secrets
!.env.example         # keep the safe template available
.git                  # no VCS history
npm-debug.log*        # log noise
coverage              # generated reports
```

Plus context-specific entries: `dist` (rebuilt inside the image),
`backend/test`, `backend/test_*.js`, `postman_test_cases.json` (tests run on
the host), and at the root the local-only `practical files/` and
`GitHub token.txt` credentials file.

Consequently `backend/.env` — which holds the JWT secret, the SMTP password and
the job encryption key — is **not part of any build context**, so it cannot end
up in an image layer. Inside the container the app finds no `.env` file at all
(`dotenv.config()` finds nothing) and reads its configuration exclusively from
the environment Compose injects.

## 9. Environment-variable setup

The backend's variable names are unchanged: `MONGO_URI`, `PORT`, `NODE_ENV`,
`JWT_SECRET`, `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_HOST`, `EMAIL_PORT`,
`FRONTEND_URL`, `JOB_PAYLOAD_ENCRYPTION_KEY`.

```yaml
backend:
  env_file:
    - ./backend/.env        # real local configuration, git-ignored
  environment:
    MONGO_URI: mongodb://mongodb:27017/task_manager   # container-specific
    PORT: 5000                                        # container-specific
```

- **`env_file` values are used as-is** (JWT, SMTP, encryption key,
  `FRONTEND_URL`, `NODE_ENV`) — local development and the container share one
  configuration source; local development is not modified.
- Only the two container-specific values are overridden.
- No placeholder credentials are committed anywhere: the `.env.example`
  template keeps its existing `your_...` placeholders.
- **Server-only secrets are never exposed to the frontend.** Vite only inlines
  variables prefixed `VITE_`; the frontend build receives exactly one build
  arg, `VITE_API_URL`, which is a URL, not a credential.
- Frontend connectivity is configured as a build arg, so it can be changed per
  environment without editing source:

```bash
VITE_API_URL=https://api.example.com docker compose build frontend
```

## 10. Single-command startup

```bash
docker compose up --build
```

Ordering is handled by Compose: `mongodb` must become **healthy** before
`backend` starts (`depends_on: condition: service_healthy`), and `backend` must
become **healthy** before `frontend` starts. `depends_on` alone only orders
*container creation*; the health checks are what guarantee that MongoDB
actually accepts connections and that the API is serving before the next
service comes up.

## 11. Inspecting logs and running containers

```bash
docker compose ps                  # status + health of all three services
docker compose logs -f backend     # follow one service
docker compose logs --tail=100     # last 100 lines, all services
docker compose logs --tail=20 frontend
docker stats                       # live CPU/memory
docker compose exec backend node -e "console.log(process.version)"
docker compose exec mongodb mongosh --quiet --eval "db.getCollectionNames()"
```

## 12. Stopping containers without deleting persistent data

```bash
docker compose stop        # stop containers, keep them and the volume
docker compose start       # start them again
docker compose down        # remove containers + network, KEEP mongo_data
docker compose restart     # restart in place
```

**Never as part of normal use:**

```bash
docker compose down -v     # DELETES the mongo_data volume (data loss)
```

## 13. How to verify MongoDB persistence

1. Start the stack and create a task through the API (or the UI).
2. `docker compose down` — containers and network are removed, `mongo_data` is
   not (`docker volume ls` still lists `task-management_mongo_data`).
3. `docker compose up --build`.
4. Read the task back: it is still there, because the volume is mounted at
   `/data/db` and MongoDB re-opens those files on start.

The exact commands and observed results for this run are in §14.

## 14. Actual build and runtime test results

All commands below were executed on this machine on 2026-10-25 (Docker
29.2.1 / Compose v5.1.0, Docker Desktop Linux engine).

### 14.1 Configuration validation

```text
$ docker compose config --quiet
exit 0
```

> **Security note:** the *full* `docker compose config` output expands
> `env_file` into `environment`, so it prints the resolved `JWT_SECRET`,
> `JOB_PAYLOAD_ENCRYPTION_KEY` and `EMAIL_PASSWORD`. Validate with `--quiet`
> and never paste the full rendered output into a ticket, log or document.

### 14.2 Build

```text
$ docker compose build
 Image task-management-backend:latest  Built
 Image task-management-frontend:latest  Built
build exit=0
```

The first attempt failed (11 `UNRESOLVED_IMPORT` errors) and exposed the
case-sensitivity bug described at the end of this document; after correcting
the 11 import specifiers the build succeeded.

### 14.3 Single-command startup

```text
$ docker compose up --build
 Container task-management-mongodb-1   Waiting
 Container task-management-mongodb-1   Healthy
 Container task-management-backend-1   Waiting
 Container task-management-backend-1   Healthy
 Container task-management-frontend-1  Starting
```

The health-gated ordering is visible: MongoDB healthy → backend starts →
backend healthy → frontend starts. Final state:

```text
$ docker compose ps
SERVICE    STATUS                        PORTS
backend    Up 4 minutes (healthy)        0.0.0.0:5000->5000/tcp
frontend   Up 31 seconds (healthy)       0.0.0.0:5173->5173/tcp
mongodb    Up 4 minutes (healthy)        0.0.0.0:27017->27017/tcp
```

Backend startup log (proof that it resolved `mongodb` by service name):

```text
Server running in development mode on port 5000 - 2026-10-25T15:02:01Z
MongoDB connected
[worker] email worker started (poll 2000ms, batch 5, lease 120000ms)
```

### 14.4 Frontend verification (host browser perspective)

```text
GET http://localhost:5173/                  -> 200, 853 bytes, contains <div id="root">
GET http://localhost:5173/tasks             -> 200 text/html   (SPA deep link)
GET http://localhost:5173/projects/HARSHIL3431 -> 200           (SPA deep link)
GET http://localhost:5173/assets/index-BrN_1fWK.js -> 200, 372018 bytes
  bundle contains baked API URL "http://localhost:5000" -> true
```

The bundle that is *served by the container* was built *inside* the container
(`vite build`) and carries the `VITE_API_URL` build arg, so no host `dist/`
was used.

### 14.5 Backend API verification (host → container)

```text
GET  /debug/cache-stats (no token)  -> 401          authorization intact
POST /register                      -> 201
POST /login                         -> 200 (JWT issued)
POST /tasks                         -> 201
GET  /tasks (1st / 2nd)             -> 200 / 200
cache stats after list              -> {"hits":1,"misses":1,"totalRequests":2,"hitRate":50}
GET  /  (host)                      -> 404 JSON (server reachable on host:5000)
```

Practical 10 events observed **inside the container** (no code changed):

```text
[API] POST /tasks response initiation at 2026-10-25T15:02:09.149Z (status 201)
[Notification] Task-created handler started at 2026-10-25T15:02:09.150Z
[Notification] Task "..." has no assigned user ... requested by 6ade1aa5...f0
[Notification] Task-created handler completed at 2026-10-25T15:02:11.150Z (taskId=...)
...
[Notification] Task-deleted handler started at 2026-10-25T15:08:42.067Z
[Notification] Task "..." (taskId=...) deleted by 6ade1aa5...f0
[Notification] Task-deleted handler completed at 2026-10-25T15:08:42.067Z
```

### 14.6 Practical 9 cache behaviour inside the container

```text
login -> 200
create -> 201 id=6ade1d2535cb6e4e2cd40ee5
after 2 lists -> {"hits":5,"misses":7,...}  (hits +1, misses +1)   1st MISS, 2nd HIT
delete -> 200; list after DELETE -> {"hits":5,"misses":8,...} => MISS (invalidated) OK
RESULT: PASS (auth + cache HIT + invalidation all behave in the container)
exit=0
```

### 14.7 MongoDB persistence across container recreation

```text
1. create task 6ade1aa54069a25278de25f1   (before)
2. $ docker compose down                   (containers + network removed)
   $ docker volume ls -> task-management_mongo_data   (VOLUME KEPT)
3. $ docker compose up --build             (fresh containers)
4. verification:
   POST /login (same account)                    -> 200
   GET  /tasks/6ade1aa54069a25278de25f1          -> 200  title = "Practical 11 docker persistence probe"
   GET  /tasks without token                     -> 401
   DELETE /tasks/6ade1aa54069a25278de25f1        -> 200  (cleanup)
   GET  after delete                             -> 404
```

**Data survived container recreation because of the named volume.**
No `docker compose down -v` was ever used. Final database state:
`0 probe docs; 0 total tasks` — no test data left behind.

### 14.8 Security checks

```text
backend image /app : node_modules  package-lock.json  package.json  server.js  src
frontend image /app : dist  index.html  node_modules  package-lock.json  package.json  vite.config.js
find /app -name ".env*"  ->  (nothing)   in both images
logs scan: JWT_SECRET / JOB_PAYLOAD_ENCRYPTION_KEY / EMAIL_PASSWORD / EMAIL_USER / Atlas URI -> absent
           marker scan (mongodb+srv, "Bearer <token>", "password=", JWT_SECRET) -> 0 matches
```

`backend/.env` is outside every build context (`.dockerignore`), and the
containers receive those values only at runtime through Compose `env_file`.

### 14.9 Regression tests (host, unchanged by containerization)

| Command | Result |
|---|---|
| `cd backend && npm test` | **138 pass / 0 fail** |
| `cd frontend && npm run lint` | **0 problems (exit 0)** |
| `cd frontend && npm run build` | **✓ built** (identical bundle hash `index-DNhM8H0g.js`) |
| `cd backend && npm run test:integration` | **BLOCKED** — pre-existing `TestDatabaseNotApprovedError` guard refusal (identical before/after; not bypassed) |

### 14.10 Graceful shutdown

```text
SIGTERM received, starting graceful shutdown
[worker] stopped (drained=true)
Shutdown complete
backend-1 exited with code 0
```

### 14.11 Image sizes

| Image | Size |
|---|---|
| `task-management-backend:latest` | 368 MB |
| `task-management-frontend:latest` | 460 MB |
| `mongo:7.0` | 1.18 GB |

## 15. Known limitations and troubleshooting

**Limitations**

1. **`backend/.env` is required** (same prerequisite as local development).
   If it is missing, `docker compose` fails fast with a clear message; if it
   exists but lacks `JOB_PAYLOAD_ENCRYPTION_KEY`, the backend deliberately
   exits with code 1 before listening (pre-existing fail-fast behaviour, not a
   container defect).
2. **Integration tests stay BLOCKED** by the pre-existing database guard
   (`RUN_INTEGRATION_TESTS=1` + an approved `*_test` URI are not configured).
   This is unchanged from before Practical 11 and was not bypassed.
3. **Frontend image is 460 MB.** `vite preview` must load `vite.config.js`,
   which imports `@vitejs/plugin-react`, so the runtime stage needs the
   installed dependency tree — copied from the build stage, never from the
   host. Swapping to Nginx would cut this to ~50 MB but would deviate from the
   lab's Vite-preview example.
4. **`vite preview` is a development-grade static server** (no gzip/Brotli
   caching, no TLS). Adequate for the lab; for real deployment put `dist/`
   behind Nginx or a CDN.
5. **No TLS anywhere** — plain HTTP on 5173/5000, matching the existing
   local-development setup.
6. **GitHub statistics widget has no token in containers.** `frontend/.env`
   contains a real `VITE_GITHUB_TOKEN`; it is intentionally excluded from the
   build context (never bake credentials into an image), so the containerized
   bundle calls GitHub unauthenticated and may hit the low anonymous rate
   limit — the app already handles that case with a visible rate-limit message.
7. **MongoDB is published on host `27017` without authentication.** Safe only
   on a trusted local machine; remove the `ports:` entry from the `mongodb`
   service if the host port should stay private.
8. **Standalone MongoDB, single backend instance** — no replica set, no
   horizontal scaling, no orchestration (Kubernetes/Redis intentionally not
   introduced).
9. **`docker compose config` (full output) reveals resolved secrets** — use
   `--quiet` for validation.
10. **Windows case-sensitivity gap**: 11 frontend imports required correction
    before any Linux container could build the bundle (documented at the end of
    this file).

**Troubleshooting**

| Symptom | Cause / fix |
|---|---|
| `port is already allocated` | Something else holds 5000/5173/27017 — stop it or change the host side of the mapping (`"5001:5000"`) |
| Backend exits immediately with an encryption-key message | Create/complete `backend/.env` from `.env.example` |
| `EACCES` under `node_modules/.vite-temp` | Container user cannot write to root-owned files — fixed in `frontend/Dockerfile` with `COPY --chown=node:node` |
| `UNRESOLVED_IMPORT ... components/...` during build | Import path case does not match the on-disk directory (Linux is case-sensitive) |
| Frontend loads but API calls fail | Check the baked URL (`VITE_API_URL` build arg) and that host port 5000 is published |
| Stale build result | `docker compose build --no-cache` |
| Want a clean slate **without losing data** | `docker compose down && docker compose up --build` |
| Want to erase the database (destructive!) | `docker compose down -v` — never part of normal setup |


## 16. `EXPOSE` vs Compose `ports`

- **`EXPOSE 5000`** (Dockerfile) is *documentation metadata*: it tells other
  tools which port the process listens on and lets Docker link containers on
  the same network. **It publishes nothing to the host** — a container with
  `EXPOSE 5000` is unreachable from your browser.
- **`ports: ["5000:5000"]`** (Compose) is the actual publication: it creates a
  host-side proxy so `localhost:5000` on your machine forwards into the
  container. This is what makes the browser able to reach the API.

A service reachable only inside `app-network` needs `EXPOSE`/knowledge of the
port but no `ports:` entry; a service the browser must reach needs both — which
is why `frontend` and `backend` have `ports:` while `mongodb` only needs its
`ports:` entry for host-side inspection tools.

## 17. Why copying host `node_modules` is undesirable

- **Wrong platform.** Host modules are Windows builds (`.win32-x64.node`,
  `*.dll`, `esbuild.exe`); Linux containers need ELF/musl or glibc builds. The
  result is `ERR_DLOPEN_FAILED`, `not a valid Win32 application`, or esbuild's
  "platform mismatch" error.
- **Non-reproducible.** The image would silently depend on whatever happened to
  be installed on one machine, instead of `npm ci` resolving the committed
  lockfile.
- **Wrong contents.** It drags dev dependencies, caches and local state into the
  image and blows up the build context (hundreds of MB uploaded to the daemon).
- **Different layout.** The host `node_modules` lives outside the image's build
  context anyway; the correct pattern is *install inside the image*, which both
  Dockerfiles do (`npm ci`), and which makes dependency layers cacheable.

## 18. Why a named MongoDB volume matters

Without a volume, MongoDB writes to the container's **writable layer**: every
`docker compose down`, rebuild or crash loses the database. A **named volume**
is managed by Docker, lives outside any container, and is re-mounted into
whatever container is started next — so data survives restarts, recreations and
image updates, and can be inspected/moved with `docker volume` commands. It also
keeps database files out of the repository and out of any image layer, which is
both a data-safety and a hygiene win (no `.db` files in Git, no DB inside an
image you might push).

---

## Frontend → backend connectivity

The React bundle is served by `frontend:5173`, but its `fetch()` calls execute
**in the browser**. Two consequences:

1. `http://backend:5000` would *not* work — the Compose service name exists
   only inside `app-network`, not on the host's DNS.
2. The correct target is the host-published backend port, which is what the
   code already used before containerization:

```js
// frontend/src/services/authService.js and taskService.js
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
```

`VITE_API_URL` is inlined at **build** time (the Dockerfile passes it as a
`--build-arg`); the `||` fallback preserves the exact pre-containerization
behaviour for local `npm run dev`, so nothing about existing local development
changes.

This is a cross-origin request (`http://localhost:5173` →
`http://localhost:5000`). It is already permitted by the project's existing
CORS middleware (`Access-Control-Allow-Origin: *` with
`Content-Type, Authorization` allowed), and authentication uses an `Authorization`
header rather than cookies, so no CORS relaxation, credential weakening or
auth change was required. Vite's *dev-server* proxy is **not** involved:
`vite preview` does not read `server.proxy`, which is exactly why the
browser-visible URL approach was used instead.

## Port 5173 vs Vite's default

`vite preview` defaults to **4173**; 5173 is Vite's *dev-server* port and the
port this practical documents. The container therefore passes
`--port 5173` explicitly, and Compose maps `5173:5173`, so the documented URL
`http://localhost:5173` is both true and stable.

## Container-specific application fix (case sensitivity)

The first in-container build failed with 11 `UNRESOLVED_IMPORT` errors:
`src/pages/Home.jsx` and `src/pages/Projects.jsx` imported
`../components/...`, while the real directory is `src/Components/`. Windows
(and macOS default) filesystems are case-insensitive, so the project built and
ran fine on the host; Linux containers are case-sensitive and rejected it.

The fix corrected the 11 import specifiers to `../Components/` — matching both
the on-disk directory and the convention already used by `App.jsx`,
`Tasks.jsx` and `Components/AuthForm.jsx`. No file was renamed or moved, no
behaviour changed (host `npm run lint` and `npm run build` still pass, and the
build output hash is unchanged).

A repository-wide check confirmed no other such mismatch exists: all backend
relative imports already match exact on-disk case.
