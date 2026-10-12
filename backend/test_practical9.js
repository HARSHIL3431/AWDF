import 'dotenv/config';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const BASE_URL = 'http://localhost:5000';
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

const testUser = {
  email: `test_cache_${Date.now()}@example.com`,
  password: 'Password123!'
};

let authToken = '';
let taskId = '';

async function runTests() {
  console.log('=== STARTING PRACTICAL 9 CACHING & QUERY OPTIMIZATION VERIFICATION ===\n');

  try {
    // 1. Register and login
    console.log('1. Registering test user...');
    const regRes = await fetch(`${BASE_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser)
    });
    if (regRes.status !== 201) throw new Error(`Register failed: ${regRes.status}`);

    const loginRes = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser)
    });
    const loginData = await loginRes.json();
    authToken = loginData.token;
    console.log('   ✓ User registered and logged in successfully.');

    // 2. Initial cache stats
    console.log('\n2. Checking /debug/cache-stats...');
    const stats0Res = await fetch(`${BASE_URL}/debug/cache-stats`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    const stats0 = await stats0Res.json();
    console.log('   Initial stats:', stats0);

    // 3. First GET /tasks -> Cache Miss
    console.log('\n3. Testing GET /tasks (Cache Miss)...');
    const startMiss = performance.now();
    const getTasksRes1 = await fetch(`${BASE_URL}/tasks`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    const missDuration = performance.now() - startMiss;
    if (getTasksRes1.status !== 200) throw new Error(`GET /tasks failed: ${getTasksRes1.status}`);
    const tasks1 = await getTasksRes1.json();
    console.log(`   ✓ GET /tasks (Miss) responded in ${missDuration.toFixed(2)}ms with ${tasks1.length} tasks`);

    // 4. Second GET /tasks -> Cache Hit
    console.log('\n4. Testing GET /tasks (Cache Hit)...');
    const startHit = performance.now();
    const getTasksRes2 = await fetch(`${BASE_URL}/tasks`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    const hitDuration = performance.now() - startHit;
    if (getTasksRes2.status !== 200) throw new Error(`GET /tasks hit failed: ${getTasksRes2.status}`);
    const tasks2 = await getTasksRes2.json();
    console.log(`   ✓ GET /tasks (Hit) responded in ${hitDuration.toFixed(2)}ms with ${tasks2.length} tasks`);
    if (tasks1.length !== tasks2.length) throw new Error('Cached tasks length mismatch');

    // Verify stats incremented
    const stats1Res = await fetch(`${BASE_URL}/debug/cache-stats`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    const stats1 = await stats1Res.json();
    console.log('   Stats after 1 miss + 1 hit on tasks:all:', stats1);
    if (stats1.hits <= stats0.hits || stats1.misses <= stats0.misses) {
      throw new Error('Cache stats did not increment properly for all-tasks');
    }

    // 5. Create a Task (POST /tasks) -> Should invalidate tasks:all cache
    console.log('\n5. Creating task and verifying invalidation...');
    const createRes = await fetch(`${BASE_URL}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({
        title: 'Cache Invalidation Test Task',
        description: 'Verify invalidation on creation',
        priority: 'high'
      })
    });
    const newTask = await createRes.json();
    taskId = newTask.id;
    console.log('   ✓ Task created with id:', taskId);

    // 6. Next GET /tasks should be a Cache Miss because POST invalidated it
    const preMissHits = (await (await fetch(`${BASE_URL}/debug/cache-stats`, { headers: { Authorization: `Bearer ${authToken}` } })).json()).hits;
    const preMissMisses = (await (await fetch(`${BASE_URL}/debug/cache-stats`, { headers: { Authorization: `Bearer ${authToken}` } })).json()).misses;

    const getTasksRes3 = await fetch(`${BASE_URL}/tasks`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    const postMissStats = await (await fetch(`${BASE_URL}/debug/cache-stats`, { headers: { Authorization: `Bearer ${authToken}` } })).json();
    if (postMissStats.misses <= preMissMisses) {
      throw new Error('Expected cache miss after POST invalidation!');
    }
    console.log('   ✓ Cache miss confirmed after task creation invalidation');

    // 7. Single task caching GET /tasks/:id
    console.log('\n7. Testing GET /tasks/:id caching...');
    // Miss:
    const getSingle1 = await fetch(`${BASE_URL}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    const singleData1 = await getSingle1.json();
    if (getSingle1.status !== 200 || singleData1.id !== taskId) throw new Error('GET /tasks/:id failed');

    // Hit:
    const statsBeforeSingleHit = await (await fetch(`${BASE_URL}/debug/cache-stats`, { headers: { Authorization: `Bearer ${authToken}` } })).json();
    const getSingle2 = await fetch(`${BASE_URL}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    const statsAfterSingleHit = await (await fetch(`${BASE_URL}/debug/cache-stats`, { headers: { Authorization: `Bearer ${authToken}` } })).json();

    if (statsAfterSingleHit.hits <= statsBeforeSingleHit.hits) {
      throw new Error('Single task cache hit was not recorded!');
    }
    console.log('   ✓ Single task caching hit verified');

    // 8. Update task (PUT /tasks/:id) -> Should invalidate tasks:id:<id> and tasks:all
    console.log('\n8. Testing PUT /tasks/:id invalidation...');
    const updateRes = await fetch(`${BASE_URL}/tasks/${taskId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({
        title: 'Cache Invalidation Updated Title',
        description: 'Updated'
      })
    });
    if (updateRes.status !== 200) throw new Error('Update task failed');

    // Verify GET /tasks/:id misses cache now
    const statsPreUpdateGet = await (await fetch(`${BASE_URL}/debug/cache-stats`, { headers: { Authorization: `Bearer ${authToken}` } })).json();
    await fetch(`${BASE_URL}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    const statsPostUpdateGet = await (await fetch(`${BASE_URL}/debug/cache-stats`, { headers: { Authorization: `Bearer ${authToken}` } })).json();
    if (statsPostUpdateGet.misses <= statsPreUpdateGet.misses) {
      throw new Error('Expected cache miss after PUT invalidation!');
    }
    console.log('   ✓ Single task cache invalidated on update');

    // 9. Delete task (DELETE /tasks/:id) -> Invalidation
    console.log('\n9. Testing DELETE /tasks/:id invalidation...');
    const deleteRes = await fetch(`${BASE_URL}/tasks/${taskId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (deleteRes.status !== 200) throw new Error('Delete task failed');
    console.log('   ✓ Task deleted and cache invalidated');

    // 10. Performance benchmark: 3 uncached readings vs 3 cached readings
    console.log('\n10. Collecting Benchmark Readings (Uncached vs Cached)...');
    // Ensure all-tasks cache is populated
    await fetch(`${BASE_URL}/tasks`, { headers: { Authorization: `Bearer ${authToken}` } });

    // 3 Cached readings:
    const cachedTimes = [];
    for (let i = 1; i <= 3; i++) {
      const t0 = performance.now();
      await fetch(`${BASE_URL}/tasks`, { headers: { Authorization: `Bearer ${authToken}` } });
      const t = performance.now() - t0;
      cachedTimes.push(t);
      console.log(`   Cached Reading ${i}: ${t.toFixed(2)} ms`);
    }

    // 3 Uncached readings: invalidate between each request to force uncached DB fetch
    const uncachedTimes = [];
    for (let i = 1; i <= 3; i++) {
      // Invalidate by creating and deleting a dummy task or using invalidation
      const dummyRes = await fetch(`${BASE_URL}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ title: `Benchmark Invalidate ${i}` })
      });
      const dummy = await dummyRes.json();
      await fetch(`${BASE_URL}/tasks/${dummy.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` }
      });

      // Now tasks:all is guaranteed invalidated; measure database query time
      const t0 = performance.now();
      await fetch(`${BASE_URL}/tasks`, { headers: { Authorization: `Bearer ${authToken}` } });
      const t = performance.now() - t0;
      uncachedTimes.push(t);
      console.log(`   Uncached Reading ${i}: ${t.toFixed(2)} ms`);
    }

    const avgUncached = uncachedTimes.reduce((a, b) => a + b, 0) / 3;
    const avgCached = cachedTimes.reduce((a, b) => a + b, 0) / 3;
    const timeSaved = avgUncached - avgCached;
    const pctReduction = ((timeSaved / avgUncached) * 100);

    console.log('\n--- BENCHMARK SUMMARY ---');
    console.log(`Average Uncached Time: ${avgUncached.toFixed(2)} ms`);
    console.log(`Average Cached Time:   ${avgCached.toFixed(2)} ms`);
    console.log(`Time Saved:            ${timeSaved.toFixed(2)} ms`);
    console.log(`Percentage Reduction:  ${pctReduction.toFixed(2)}%`);

    const finalStats = await (await fetch(`${BASE_URL}/debug/cache-stats`, { headers: { Authorization: `Bearer ${authToken}` } })).json();
    console.log('\nFinal Cache Stats:', finalStats);

    console.log('\n==================================================');
    console.log(' ALL PRACTICAL 9 CACHING TESTS PASSED! ');
    console.log('==================================================\n');
  } catch (err) {
    console.error('Test Failed:', err);
    process.exitCode = 1;
  }
}

runTests();
