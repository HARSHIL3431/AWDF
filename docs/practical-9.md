# Practical 9: In-Memory Caching & Query Optimization

## 1. Overview
This document covers the implementation, architecture, and benchmarking results for **Practical 9: In-Memory Caching and Query Optimization** in the Task Management Express/MongoDB application.

---

## 2. Architecture & Design

### Cache Service Module
- **File:** `src/services/cacheService.js`
- **Library:** `node-cache`
- **Default TTL:** 60 seconds (`stdTTL: 60`)
- **Check Period:** 120 seconds (`checkperiod: 120`)
- **Key Strategy:**
  - All tasks list: `tasks:all`
  - Single task: `tasks:id:<taskId>`

### Cache Workflow
1. **GET `/tasks`**:
   - Checks `tasks:all` in `cacheService`.
   - On cache hit: increments `hits`, returns cached JSON array immediately without triggering MongoDB queries.
   - On cache miss: increments `misses`, runs `Task.find()`, stores result in cache with 60s TTL, and returns results.
2. **GET `/tasks/:id`**:
   - `validateTaskId` checks `tasks:id:<id>`.
   - On cache hit: sets `req.task` from cache, skips database lookup.
   - On cache miss: queries `Task.findById(id)`, caches the result, sets `req.task`.
3. **Cache Invalidation**:
   - `POST /tasks`: Clears `tasks:all`.
   - `PUT /tasks/:id`: Clears `tasks:all` and `tasks:id:<id>`.
   - `DELETE /tasks/:id`: Clears `tasks:all` and `tasks:id:<id>`.

---

## 3. Cache Statistics & Debug Endpoint

- **Endpoint:** `GET /debug/cache-stats`
- **Authorization:** Requires valid JWT (`Bearer <token>`)
- **Response Format:**
```json
{
  "hits": 5,
  "misses": 8,
  "totalRequests": 13,
  "hitRate": 38.46
}
```
- Formula: `hitRate = (hits / (hits + misses)) * 100`

---

## 4. Benchmark Readings (Uncached vs Cached)

Tested on Node.js v22+, Express, and MongoDB Atlas (Cloud Cluster):

| Condition | Reading 1 (ms) | Reading 2 (ms) | Reading 3 (ms) | Average (ms) |
|---|---:|---:|---:|---:|
| **Uncached (MongoDB Query)** | 73.18 | 113.44 | 27.99 | **71.54** |
| **Cached (In-Memory `node-cache`)** | 4.76 | 5.35 | 3.65 | **4.59** |

### Calculations
- **Time Saved:** $71.54\text{ ms} - 4.59\text{ ms} = 66.95\text{ ms}$
- **Percentage Reduction:** $\frac{66.95}{71.54} \times 100 \approx 93.59\%$

---

## 5. Technical Reflection & TTL Analysis

### 5.1 TTL Trade-Off
- A **60-second TTL** is ideal for task lists as it balances fresh read data with low load on MongoDB.
- **Short TTL (e.g., 5s):** Higher database load and frequent cache misses under read-heavy traffic.
- **Long TTL (e.g., 10m):** High cache efficiency, but risks serving stale data for longer if cache invalidation is missed. Explicit invalidation on POST/PUT/DELETE ensures stale data is eliminated immediately regardless of TTL length.

### 5.2 Why node-cache is unsuitable for multi-instance deployments
- `node-cache` is strictly in-process memory. In a multi-instance/load-balanced environment (e.g. cluster or Kubernetes), an update processed on Instance A would only invalidate Instance A's memory. Instance B would continue serving stale data.
- For multi-instance architectures, a distributed cache such as **Redis** or **Memcached** should be used.

### 5.3 Server Restart Behavior
- Since cache resides in RAM, restarting the Node.js process clears all cache entries. On startup, the first read requests will naturally register as cache misses and re-warm the cache from MongoDB.

---

## 6. Independent Verification (2026-10-25)

A requirement-by-requirement audit of this practical is available at [docs/practical-9-audit.md](practical-9-audit.md). It adds:

- **14 automated cache tests** in `backend/test/cache.test.js` (miss/hit, DB-query avoidance, empty-result caching, error non-caching, per-id isolation, response-shape parity, POST/PUT/DELETE invalidation, statistics math, TTL expiry, endpoint token guard) — all passing within `npm test` (123/123).
- **An independently measured, read-only benchmark** (3 rounds, miss/hit confirmed via `/debug/cache-stats` deltas): uncached avg **70.17 ms**, cached avg **2.08 ms**, time saved **68.09 ms**, reduction **97.03 %** — the same order of magnitude as the readings recorded in §4 above.
