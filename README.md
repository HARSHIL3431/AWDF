# Student Portfolio — Full Stack Task Manager

[![CI Pipeline](https://github.com/HARSHIL3431/AWDF/actions/workflows/ci.yml/badge.svg)](https://github.com/HARSHIL3431/AWDF/actions/workflows/ci.yml)

React + Express + MongoDB Atlas full-stack application.

## Prerequisites

- Node.js 18+
- MongoDB Atlas cluster with IP whitelist enabled

## Setup

### Backend

```bash
cd backend
npm install
cp .env.example .env   # add your MONGO_URI
npm run dev
```

Server runs on `http://localhost:5000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

### Both (from root)

```bash
npm run dev
```

## API Endpoints

| Method | Endpoint            | Description                                  |
|--------|---------------------|----------------------------------------------|
| GET    | /tasks              | List all tasks (Cached with 60s TTL)         |
| GET    | /tasks/:id          | Get task by ID (Cached)                      |
| POST   | /tasks              | Create a task (Invalidates task list cache)  |
| PUT    | /tasks/:id          | Update a task (Invalidates affected caches)  |
| DELETE | /tasks/:id          | Delete a task (Invalidates affected caches)  |
| GET    | /debug/cache-stats  | Cache statistics (hits, misses, hit rate)    |
| GET    | /debug/jobs         | Job statistics (authenticated, aggregates)   |

## Asynchronous Job Processing (password-reset emails)

Password-reset emails are delivered by a durable background-job workflow, not
on the HTTP request path. `POST /forgot-password` saves the (SHA-256-hashed)
reset token and enqueues an `email.password_reset` job in MongoDB, then returns
the same generic response as before. An in-process worker claims jobs and sends
the email through the existing SMTP configuration.

This is a Mongo-backed durable job queue with event-driven dispatch inside the
application process. It is **not** a message broker, microservice, or
general-purpose event bus (no Redis/BullMQ/RabbitMQ/Kafka).

### Encryption key setup

Job payloads are encrypted with AES-256-GCM. The key must be exactly 64
hexadecimal characters (32 bytes), provided via `JOB_PAYLOAD_ENCRYPTION_KEY`:

```bash
# Generate a key (never commit or share it)
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

# backend/.env
JOB_PAYLOAD_ENCRYPTION_KEY=<paste the generated 64-char hex value>
```

- The server **fails fast at startup** with a remediation message if the key is
  missing or malformed. No key is ever auto-generated and there is no plaintext
  fallback.
- Keep the key stable across restarts; rotating it makes existing queued
  payloads undecryptable (those jobs move to `dead`).
- Never put the real key in `.env.example`, docs, logs, or source control.

### How the queue and worker operate

- `backend/src/models/jobModel.js` — job documents (`type`, `status`,
  encrypted `payload` with `select:false`, `attempts`, `nextAttemptAt`,
  `leaseUntil`, `correlationId`, sanitized `errorCategory`/`errorMessage`,
  `expiresAt` for terminal jobs).
- `backend/src/services/jobService.js` — enqueue, atomic claim
  (`pending → processing` via guarded `findOneAndUpdate`), completion, retry
  scheduling, dead-lettering, expired-lease recovery, aggregate statistics.
- `backend/src/workers/emailWorker.js` — single sequential polling loop
  (batch 5, poll interval 2s) started **only after MongoDB connects**; never at
  module import. Stops claiming on shutdown.
- `backend/src/security/payloadEncryption.js` — AES-256-GCM envelope
  `{v, iv, tag, ct}` with purpose-bound AAD; a fresh random nonce per job.

Job states and retry policy:

```
pending → processing → succeeded
processing → pending   (retryable failure or expired-lease recovery)
processing → dead      (attempts exhausted or non-retryable failure)
```

- Max attempts: 5; backoff `min(30s × 2^(n−1), 15min)` with jitter.
- Lease: 120s (always greater than worst-case SMTP time of 50s:
  connection 10s + greeting 10s + socket 30s), so live sends are never stolen.
- Terminal jobs (`succeeded`/`dead`) are retained for **7 days** (`expiresAt`
  TTL index), then deleted. Active jobs are never TTL-deleted.
- **At-least-once delivery:** if SMTP accepts a message and the process crashes
  before success is persisted, the retry can send a duplicate email with the
  same (still valid) reset link. Exactly-once delivery is not claimed.

### Rate limiting

`POST /forgot-password` is limited to **5 requests per 15 minutes per IP**,
keyed on the socket remote address (`X-Forwarded-For` is ignored because the
app does not run behind a verified trusted proxy). Excess requests get
`429 {"error":"Too many requests. Please try again later."}` with `Retry-After`.

Known limitation: the limiter is **process-local** — counters reset on restart
and are not shared across multiple instances. This is not distributed rate
limiting. Other routes are unaffected.

### Startup and shutdown

1. Config loads; the encryption key is validated (fail-fast, exit 1 if bad).
2. The HTTP server starts on the configured port (existing convention).
3. On successful `mongoose.connect`, the worker starts polling.
4. `SIGINT`/`SIGTERM`: the worker stops claiming new jobs and waits up to 10s
   for the in-flight job, then the HTTP server and MongoDB connection close.
   An undrained job stays `processing` and is reclaimed via lease expiry after
   the next start. A safety net logs and exits on unhandled promise rejections.

### Job statistics endpoint

`GET /debug/jobs` (requires `Authorization: Bearer <JWT>`, same
`authenticateToken` convention as `/debug/cache-stats`):

```json
{
  "counts": { "pending": 0, "processing": 0, "succeeded": 0, "dead": 0, "total": 0 },
  "queued": 0,
  "processingCount": 0,
  "deadCount": 0,
  "oldestPendingAgeMs": null,
  "enqueueFailures": 0
}
```

It returns aggregates only — never payloads, tokens, emails, correlation IDs,
raw error text, or encryption material.

### Operational limitations

- Enqueue failure policy: if the user update succeeds but the job insert fails,
  the API still returns the generic accepted response (no synchronous email
  fallback), records a sanitized `enqueueFailures` counter, and the user may
  need to retry; the reset token simply expires after 15 minutes.
- The rate limiter is in-process (see above).
- Reset tokens are redacted from request/error logs
  (`/reset-password/[REDACTED]`, 64-hex tokens, email addresses).

## Docker (Practical 11)

The whole stack — React frontend, Express backend and MongoDB — starts with one
command from the repository root:

```bash
docker compose up --build
```

| Service   | Container port | Host port | What runs inside                                  |
|-----------|----------------|-----------|---------------------------------------------------|
| `frontend`| 5173           | 5173      | `vite preview` serving the production bundle       |
| `backend` | 5000           | 5000      | REST API (the browser-visible API endpoint)        |
| `mongodb` | 27017          | 27017     | MongoDB 7 with the named volume `mongo_data`        |

Prerequisite (identical to local development): `backend/.env` must exist —
create it once from `backend/.env.example`. Compose overrides only
`MONGO_URI=mongodb://mongodb:27017/task_manager` and `PORT=5000` inside the
container, so the three services reach each other by Compose service name on
the `app-network` bridge network.

Host `node_modules`, `.env` and `.git` are excluded by the `.dockerignore`
files, so no credentials and no host dependencies enter an image.

```bash
docker compose ps            # service status and health
docker compose logs -f backend
docker compose stop          # stop containers, KEEP all MongoDB data
docker compose down          # remove containers, KEEP the mongo_data volume
docker compose down -v       # deletes the database volume — never part of setup
```

Details, verification results and troubleshooting:
[docs/practical-11-docker.md](docs/practical-11-docker.md).

## Documentation
- [Practical 8 Docs](docs/practical-8.md)
- [Practical 9 In-Memory Caching & Query Optimization](docs/practical-9.md)
- [Practical 10 Asynchronous Event-Driven Notifications](docs/practical-10-events.md)
- [Practical 11 Docker Containerization & Compose](docs/practical-11-docker.md)

## Running Tests

```bash
# Safe unit tests (node:test, no database, no SMTP, no network) — preferred
cd backend
npm test

# Integration tests (real MongoDB): ONLY run after configuring AND approving
# an isolated test database (see below). Refuse to run otherwise.
npm run test:integration

# Ad-hoc integration scripts: require a RUNNING server and mutate real
# dev/Atlas state. Do not run them without explicit authorization.
node test_backend.js       # Practical 7 & Auth tests
node test_practical9.js    # Practical 9 Cache & Benchmark tests
node test_practical10.js   # Practical 10 event-driven notification demo

# Frontend lint
cd frontend && npm run lint
```

Test suite coverage: encryption round-trip/tampering/purpose/key handling,
job lifecycle (enqueue, atomic claim, retry, dead-letter, lease recovery,
retention), worker (success/retry/shutdown/recovery), forgot-password response
contract and enumeration safety, rate-limit boundaries, log-token redaction,
authenticated job statistics, login/register/reset regression checks, and the
database-guard refusal matrix.

### Integration tests (isolated database required)

`backend/test/integration/` exercises real MongoDB persistence, concurrent
atomic claiming, retry/dead-letter/lease recovery, the worker's graceful
shutdown, forgot-password end-to-end compatibility, and the statistics
endpoint. Email transport is mocked everywhere — no real email is ever sent.

They are hard-gated by `backend/test/helpers/dbGuard.js`, which **refuses to
run (before any connection) unless an isolated test database is explicitly
configured and approved**. Required `backend/.env` configuration:

```bash
RUN_INTEGRATION_TESTS=1
TEST_MONGO_URI=mongodb://<user>:<password>@<host>:27017/task_manager_test?authSource=admin
```

Enforced rules: `TEST_MONGO_URI` is never read by the application (the app
uses `MONGO_URI`); its database name must match `<name>_test` and differ from
the development database; the two URIs must differ; `NODE_ENV` must not be
`production`; after connecting, the live database name is re-verified and the
connection is closed immediately on any mismatch. Destructive operations are
limited to `deleteMany` on `jobs`/`users` inside the verified test database —
no drops. Remove `RUN_INTEGRATION_TESTS=1` afterwards to disable the suite.
The database must belong to you (or a disposable local instance, e.g.
`mongod` locally or a separate Atlas cluster); using a production or shared
dev database is refused by the guard.


