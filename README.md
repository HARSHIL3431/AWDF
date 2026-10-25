# Student Portfolio — Full Stack Task Manager

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
# Backend verification tests
cd backend
node test_backend.js       # Practical 7 & Auth tests
node test_practical9.js    # Practical 9 Cache & Benchmark tests
node test_practical10.js   # Practical 10 event-driven notification demo

# Frontend lint
cd frontend && npm run lint
```

