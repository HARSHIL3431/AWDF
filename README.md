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

## Documentation
- [Practical 8 Docs](docs/practical-8.md)
- [Practical 9 In-Memory Caching & Query Optimization](docs/practical-9.md)
- [Practical 10 Asynchronous Event-Driven Notifications](docs/practical-10-events.md)

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

