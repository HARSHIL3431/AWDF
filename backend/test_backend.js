import 'dotenv/config';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const BASE_URL = 'http://localhost:5000';

// Use the SAME configuration as the backend.
// Never hardcode MongoDB credentials or JWT secrets here.
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

if (!MONGO_URI) {
  throw new Error('MONGO_URI is missing from backend/.env');
}

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is missing from backend/.env');
}

const testUser = {
  email: `test_${Date.now()}@example.com`,
  password: 'Password123!'
};

let authToken = '';
let createdTaskId = '';
let registeredUserId = '';

async function runTests() {
  console.log('=== STARTING PRACTICAL 7 BACKEND VERIFICATION ===\n');

  try {
    // ---------------------------------------------------------
    // TEST 1 — REGISTER
    // ---------------------------------------------------------
    console.log('1. Testing POST /register...');

    const regRes = await fetch(`${BASE_URL}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testUser)
    });

    console.log(`   Status: ${regRes.status}`);

    const regData = await regRes.json();

    console.log('   Body:', JSON.stringify(regData));

    if (regRes.status !== 201) {
      throw new Error(`Register failed with status ${regRes.status}`);
    }

    if (regData.user?.password) {
      throw new Error('Password exposed in register response!');
    }

    if (!regData.user?.id) {
      throw new Error('Register response does not contain user ID!');
    }

    registeredUserId = regData.user.id;

    console.log('   ✓ Registration successful');
    console.log('   ✓ Password not exposed in response');

    // ---------------------------------------------------------
    // TEST 2 — VERIFY PASSWORD HASH IN MONGODB
    // ---------------------------------------------------------
    console.log('\n2. Verifying password hash directly in MongoDB Atlas...');

    await mongoose.connect(MONGO_URI);

    console.log('   ✓ Direct MongoDB Atlas connection successful');

    const dbUser = await mongoose.connection
      .db
      .collection('users')
      .findOne({ email: testUser.email });

    if (!dbUser) {
      throw new Error('Registered user was not found in MongoDB!');
    }

    if (!dbUser.password) {
      throw new Error('Password field not found in MongoDB!');
    }

    console.log(
      `   Stored password hash: ${dbUser.password.substring(0, 7)}********`
    );

    if (dbUser.password === testUser.password) {
      throw new Error('Plaintext password stored in MongoDB!');
    }

    if (
      !dbUser.password.startsWith('$2a$') &&
      !dbUser.password.startsWith('$2b$')
    ) {
      throw new Error('Password in MongoDB is not a valid bcrypt hash!');
    }

    console.log('   ✓ Password is NOT stored as plaintext');
    console.log('   ✓ Password is stored as bcrypt hash');

    await mongoose.disconnect();

    // ---------------------------------------------------------
    // TEST 3 — LOGIN CORRECT PASSWORD
    // ---------------------------------------------------------
    console.log('\n3. Testing POST /login (correct password)...');

    const loginRes = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testUser)
    });

    console.log(`   Status: ${loginRes.status}`);

    const loginData = await loginRes.json();

    console.log(
      '   Token received:',
      loginData.token
        ? `${loginData.token.slice(0, 20)}...`
        : 'NONE'
    );

    if (loginRes.status !== 200 || !loginData.token) {
      throw new Error('Login failed!');
    }

    authToken = loginData.token;

    if (loginData.user?.password) {
      throw new Error('Password exposed in login response!');
    }

    console.log('   ✓ Login successful');
    console.log('   ✓ JWT token received');
    console.log('   ✓ Password not exposed');

    // ---------------------------------------------------------
    // TEST 4 — LOGIN WRONG PASSWORD
    // ---------------------------------------------------------
    console.log('\n4. Testing POST /login (wrong password)...');

    const wrongLoginRes = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: testUser.email,
        password: 'WrongPassword'
      })
    });

    console.log(`   Status: ${wrongLoginRes.status}`);

    if (wrongLoginRes.status !== 401) {
      throw new Error(
        `Expected 401 but received ${wrongLoginRes.status}`
      );
    }

    console.log('   ✓ Invalid credentials correctly rejected');

    // ---------------------------------------------------------
    // TEST 5 — TASKS WITHOUT TOKEN
    // ---------------------------------------------------------
    console.log('\n5. Testing GET /tasks without token...');

    const noTokenRes = await fetch(`${BASE_URL}/tasks`);

    console.log(`   Status: ${noTokenRes.status}`);

    if (noTokenRes.status !== 401) {
      throw new Error(`Expected 401 but received ${noTokenRes.status}`);
    }

    console.log('   ✓ Protected route rejected unauthenticated request');

    // ---------------------------------------------------------
    // TEST 6 — INVALID TOKEN
    // ---------------------------------------------------------
    console.log('\n6. Testing GET /tasks with invalid token...');

    const invalidTokenRes = await fetch(`${BASE_URL}/tasks`, {
      headers: {
        Authorization: 'Bearer invalid_garbage_token'
      }
    });

    console.log(`   Status: ${invalidTokenRes.status}`);

    if (invalidTokenRes.status !== 401) {
      throw new Error(
        `Expected 401 but received ${invalidTokenRes.status}`
      );
    }

    console.log('   ✓ Invalid JWT correctly rejected');

    // ---------------------------------------------------------
    // TEST 7 — VALID TOKEN GET TASKS
    // ---------------------------------------------------------
    console.log('\n7. Testing GET /tasks with valid Bearer token...');

    const tasksRes = await fetch(`${BASE_URL}/tasks`, {
      headers: {
        Authorization: `Bearer ${authToken}`
      }
    });

    console.log(`   Status: ${tasksRes.status}`);

    const tasksData = await tasksRes.json();

    console.log(`   Found ${tasksData.length} tasks`);

    if (tasksRes.status !== 200 || !Array.isArray(tasksData)) {
      throw new Error('GET /tasks failed with valid token');
    }

    console.log('   ✓ Authenticated GET /tasks successful');

    // ---------------------------------------------------------
    // TEST 8 — CREATE TASK
    // ---------------------------------------------------------
    console.log('\n8. Testing POST /tasks with valid token...');

    const createTaskRes = await fetch(`${BASE_URL}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({
        title: 'Practical 7 Verification Task',
        description: 'Testing task creation with JWT',
        priority: 'high'
      })
    });

    console.log(`   Status: ${createTaskRes.status}`);

    const createdTask = await createTaskRes.json();

    console.log('   Created Task:', createdTask);

    if (createTaskRes.status !== 201 || !createdTask.id) {
      throw new Error('POST /tasks failed');
    }

    createdTaskId = createdTask.id;

    console.log('   ✓ Task created successfully');

    // ---------------------------------------------------------
    // TEST 9 — UPDATE TASK
    // ---------------------------------------------------------
    console.log('\n9. Testing PUT /tasks/:id with valid token...');

    const updateTaskRes = await fetch(
      `${BASE_URL}/tasks/${createdTaskId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          title: 'Practical 7 Verification Task Updated',
          description: 'Updated description',
          completed: true,
          priority: 'low'
        })
      }
    );

    console.log(`   Status: ${updateTaskRes.status}`);

    const updatedTask = await updateTaskRes.json();

    console.log('   Updated Task:', updatedTask);

    if (
      updateTaskRes.status !== 200 ||
      updatedTask.title !== 'Practical 7 Verification Task Updated'
    ) {
      throw new Error('PUT /tasks/:id failed');
    }

    console.log('   ✓ Task updated successfully');

    // ---------------------------------------------------------
    // TEST 10 — GET SINGLE TASK
    // ---------------------------------------------------------
    console.log('\n10. Testing GET /tasks/:id with valid token...');

    const getSingleTaskRes = await fetch(
      `${BASE_URL}/tasks/${createdTaskId}`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      }
    );

    console.log(`   Status: ${getSingleTaskRes.status}`);

    const singleTask = await getSingleTaskRes.json();

    if (
      getSingleTaskRes.status !== 200 ||
      singleTask.id !== createdTaskId
    ) {
      throw new Error('GET /tasks/:id failed');
    }

    console.log('   ✓ Single task retrieved successfully');

    // ---------------------------------------------------------
    // TEST 11 — DELETE TASK
    // ---------------------------------------------------------
    console.log('\n11. Testing DELETE /tasks/:id with valid token...');

    const deleteTaskRes = await fetch(
      `${BASE_URL}/tasks/${createdTaskId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      }
    );

    console.log(`   Status: ${deleteTaskRes.status}`);

    if (deleteTaskRes.status !== 200) {
      throw new Error('DELETE /tasks/:id failed');
    }

    console.log('   ✓ Task deleted successfully');

    // ---------------------------------------------------------
    // TEST 12 — GET /ME
    // ---------------------------------------------------------
    console.log('\n12. Testing GET /me with valid token...');

    const meRes = await fetch(`${BASE_URL}/me`, {
      headers: {
        Authorization: `Bearer ${authToken}`
      }
    });

    console.log(`   Status: ${meRes.status}`);

    const meData = await meRes.json();

    console.log('   User Profile:', meData);

    if (
      meRes.status !== 200 ||
      meData.email !== testUser.email
    ) {
      throw new Error('GET /me failed');
    }

    if (meData.password) {
      throw new Error('GET /me exposed password!');
    }

    console.log('   ✓ /me returned authenticated user');
    console.log('   ✓ Password not exposed');

    // ---------------------------------------------------------
    // TEST 13 — MALFORMED JWT
    // ---------------------------------------------------------
    console.log('\n13. Testing server stability with malformed JWT...');

    const malformedRes = await fetch(`${BASE_URL}/tasks`, {
      headers: {
        Authorization: 'Bearer malformed.jwt.payload'
      }
    });

    console.log(`   Status: ${malformedRes.status}`);

    if (malformedRes.status !== 401) {
      throw new Error(
        `Expected 401 but received ${malformedRes.status}`
      );
    }

    console.log('   ✓ Malformed JWT safely rejected');

    // ---------------------------------------------------------
    // TEST 14 — EXPIRED JWT
    // ---------------------------------------------------------
    console.log('\n14. Testing expired token...');

    const expiredToken = jwt.sign(
      {
        id: registeredUserId
      },
      JWT_SECRET,
      {
        expiresIn: '0s'
      }
    );

    const expiredRes = await fetch(`${BASE_URL}/tasks`, {
      headers: {
        Authorization: `Bearer ${expiredToken}`
      }
    });

    console.log(`   Status: ${expiredRes.status}`);

    if (expiredRes.status !== 401) {
      throw new Error(
        `Expected 401 but received ${expiredRes.status}`
      );
    }

    console.log('   ✓ Expired JWT correctly rejected');

    // ---------------------------------------------------------
    // FINAL RESULT
    // ---------------------------------------------------------
    console.log('\n==================================================');
    console.log(' ALL BACKEND TESTS PASSED SUCCESSFULLY! ');
    console.log('==================================================\n');

  } catch (error) {
    console.error('\n TEST FAILED:', error.message);
    process.exitCode = 1;
  } finally {
    // Make sure the test never leaves a MongoDB connection open.
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => { });
    }
  }
}

runTests();