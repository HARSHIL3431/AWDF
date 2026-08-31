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

| Method | Endpoint     | Description       |
|--------|-------------|-------------------|
| GET    | /tasks      | List all tasks    |
| GET    | /tasks/:id  | Get task by ID    |
| POST   | /tasks      | Create a task     |
| PUT    | /tasks/:id  | Update a task     |
| DELETE | /tasks/:id  | Delete a task     |

## Running Tests

```bash
# Backend manual testing via Postman (see backend/postman_test_cases.json)
# Frontend lint
cd frontend && npm run lint
```
