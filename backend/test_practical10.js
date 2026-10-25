import 'dotenv/config';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

// Practical 10 — runtime demonstration of the event-driven notification flow.
// Requires a RUNNING server (npm start) and the development MongoDB.
// Like test_practical9.js this is an ad-hoc script: it registers a throwaway
// test account, creates ONE demo task, and deletes it again (plus one extra
// DELETE that is expected to return 404). No pre-existing task is modified.

const BASE_URL = 'http://localhost:5000';

const testUser = {
  email: `test_events_${Date.now()}@example.com`,
  password: 'Password123!'
};

const NOTIFICATION_DELAY_MS = 2000;
const SETTLE_MS = 3500; // give the notification handler time to complete

let authToken = '';

const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  return { status: res.status, body: await res.json() };
}

async function runDemo() {
  console.log('=== PRACTICAL 10 — ASYNCHRONOUS EVENT-DRIVEN NOTIFICATION DEMO ===\n');
  console.log(`Client clock start: ${now()}`);

  try {
    // 1. Register + login a dedicated test account
    console.log('\n1. Registering and logging in a dedicated test account...');
    const reg = await fetch(`${BASE_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser)
    });
    if (reg.status !== 201) throw new Error(`Register failed: ${reg.status} ${JSON.stringify(await reg.json())}`);
    const login = await getJson('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser)
    });
    if (login.status !== 200) throw new Error(`Login failed: ${login.status}`);
    authToken = login.body.token;
    console.log(`   OK account=${testUser.email} (token acquired)`);

    // 2. Baseline cache statistics (Practical 9 debug endpoint still protected)
    const noAuth = await fetch(`${BASE_URL}/debug/cache-stats`);
    if (noAuth.status !== 401) throw new Error(`cache-stats must stay protected, got ${noAuth.status}`);
    const stats0 = (await getJson('/debug/cache-stats', { headers: { Authorization: `Bearer ${authToken}` } })).body;
    console.log(`\n2. Cache stats baseline (unauthenticated call returned 401 as required): ${JSON.stringify(stats0)}`);

    // 3. POST /tasks — the core asynchronous-event demonstration
    console.log('\n3. Creating a task (POST /tasks)...');
    const clientSentAt = now();
    const t0 = performance.now();
    const createRes = await fetch(`${BASE_URL}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({
        title: 'Practical 10 event notification demo',
        description: 'Created to demonstrate task-created events',
        priority: 'medium'
      })
    });
    const createDurationMs = performance.now() - t0;
    const clientReceivedAt = now();
    const created = await createRes.json();
    if (createRes.status !== 201) throw new Error(`Create failed: ${createRes.status} ${JSON.stringify(created)}`);

    console.log(`   client request sent at   : ${clientSentAt}`);
    console.log(`   HTTP status              : ${createRes.status}`);
    console.log(`   response payload id      : ${created.id}`);
    console.log(`   response payload title   : ${created.title}`);
    console.log(`   client received at       : ${clientReceivedAt}`);
    console.log(`   client-measured duration : ${createDurationMs.toFixed(2)} ms`);
    console.log(
      `   NOTE: the notification handler needs ~${NOTIFICATION_DELAY_MS} ms; ` +
      `the client response ${createDurationMs < NOTIFICATION_DELAY_MS ? 'did NOT wait for it' : 'WAITED for it'} ` +
      `(duration ${createDurationMs.toFixed(2)} ms vs ${NOTIFICATION_DELAY_MS} ms delay)`
    );
    if (createDurationMs >= NOTIFICATION_DELAY_MS) {
      throw new Error('API response waited for the notification delay — non-blocking requirement violated');
    }

    // 4. Wait for the asynchronous notification to finish
    console.log(`\n4. Waiting ${SETTLE_MS} ms for the background notification to complete...`);
    await sleep(SETTLE_MS);
    console.log(`   waited until ${now()} — see the server log for the completion timestamp`);

    // 5. Practical 9 regression: caching + statistics still behave
    console.log('\n5. Verifying Practical 9 caching is unaffected...');
    const missStart = performance.now();
    const list1 = await getJson('/tasks', { headers: { Authorization: `Bearer ${authToken}` } });
    const missMs = performance.now() - missStart;
    if (list1.status !== 200) throw new Error('GET /tasks failed');
    const hitStart = performance.now();
    const list2 = await getJson('/tasks', { headers: { Authorization: `Bearer ${authToken}` } });
    const hitMs = performance.now() - hitStart;
    if (list1.body.length !== list2.body.length) throw new Error('cached list length mismatch');
    const stats1 = (await getJson('/debug/cache-stats', { headers: { Authorization: `Bearer ${authToken}` } })).body;
    console.log(`   GET /tasks #1 (after POST invalidated the cache): ${missMs.toFixed(2)} ms, ${list1.body.length} tasks`);
    console.log(`   GET /tasks #2 (cache hit): ${hitMs.toFixed(2)} ms, ${list2.body.length} tasks`);
    console.log(`   cache stats after create: ${JSON.stringify(stats1)}`);
    if (stats1.hits <= stats0.hits || stats1.misses <= stats0.misses) {
      throw new Error('cache statistics did not increment as before');
    }

    // 6. DELETE /tasks/:id — second event type
    console.log('\n6. Deleting the demo task (DELETE /tasks/:id)...');
    const delT0 = performance.now();
    const deleteRes = await fetch(`${BASE_URL}/tasks/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    const delMs = performance.now() - delT0;
    const deleted = await deleteRes.json();
    if (deleteRes.status !== 200) throw new Error(`Delete failed: ${deleteRes.status} ${JSON.stringify(deleted)}`);
    console.log(`   HTTP status              : ${deleteRes.status}`);
    console.log(`   response payload         : ${JSON.stringify(deleted)}`);
    console.log(`   client-measured duration : ${delMs.toFixed(2)} ms`);

    // 7. Second DELETE of the same id must 404 and must NOT emit a success event
    console.log('\n7. Deleting the same id again (expected 404, no task-deleted event)...');
    const again = await fetch(`${BASE_URL}/tasks/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log(`   HTTP status: ${again.status} body: ${JSON.stringify(await again.json())}`);
    if (again.status !== 404) throw new Error('second delete should return 404');

    // 8. Final cache statistics
    const statsFinal = (await getJson('/debug/cache-stats', { headers: { Authorization: `Bearer ${authToken}` } })).body;
    console.log(`\n8. Final cache stats: ${JSON.stringify(statsFinal)}`);

    console.log('\n==================================================');
    console.log(' PRACTICAL 10 RUNTIME DEMO COMPLETED — check the');
    console.log(' server log for [API] and [Notification] timestamps.');
    console.log('==================================================\n');
  } catch (err) {
    console.error('Demo Failed:', err);
    process.exitCode = 1;
  }
}

runDemo();
