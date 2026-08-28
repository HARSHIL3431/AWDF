import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';


const BASE_URL = 'http://localhost:5000';
const MONGO_URI = 'mongodb+srv://24aiml068_db_user:YX6qfYE03r8L0c7F@first.fq6ywno.mongodb.net/task_manager?retryWrites=true&w=majority';
const JWT_SECRET = 'practical7_jwt_secret_key_987654321';

const testUser = {
  email: `test_${Date.now()}@example.com`,
  password: 'Password123!'
};

let authToken = '';
let createdTaskId = '';

async function runTests() {
  console.log('=== STARTING PRACTICAL 7 BACKEND VERIFICATION ===\n');

  // Test 1: POST /register
  console.log('1. Testing POST /register...');
  const regRes = await fetch(`${BASE_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testUser)
  });
  console.log(`   Status: ${regRes.status}`);
  const regData = await regRes.json();
  console.log('   Body:', JSON.stringify(regData));
  if (regRes.status !== 201) throw new Error(`Register failed with status ${regRes.status}`);
  if (regData.user && regData.user.password) throw new Error('Password exposed in register response!');

  // Test 2: Verify password in MongoDB
  console.log('\n2. Verifying password hash directly in MongoDB Atlas...');
  await mongoose.connect(MONGO_URI);
  const dbUser = await mongoose.connection.db.collection('users').findOne({ email: testUser.email });
  if (!dbUser) throw new Error('User not found in MongoDB!');
  console.log(`   MongoDB stored password: ${dbUser.password}`);
  if (dbUser.password === testUser.password) throw new Error('Plaintext password stored in MongoDB!');
  if (!dbUser.password.startsWith('$2a$') && !dbUser.password.startsWith('$2b$')) {
    throw new Error('Password in MongoDB is not a valid bcrypt hash!');
  }
  console.log('   ✓ Verified password is saved as bcrypt hash!');
  await mongoose.disconnect();

  // Test 3: POST /login (Correct password)
  console.log('\n3. Testing POST /login (correct password)...');
  const loginRes = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testUser)
  });
  console.log(`   Status: ${loginRes.status}`);
  const loginData = await loginRes.json();
  console.log('   Token received:', loginData.token ? loginData.token.slice(0, 20) + '...' : 'NONE');
  if (loginRes.status !== 200 || !loginData.token) throw new Error('Login failed!');
  authToken = loginData.token;
  if (loginData.user && loginData.user.password) throw new Error('Password exposed in login response!');

  // Test 4: POST /login (Wrong password)
  console.log('\n4. Testing POST /login (wrong password)...');
  const wrongLoginRes = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testUser.email, password: 'WrongPassword' })
  });
  console.log(`   Status: ${wrongLoginRes.status}`);
  if (wrongLoginRes.status !== 401) throw new Error(`Wrong login status expected 401 got ${wrongLoginRes.status}`);

  // Test 5: GET /tasks without token
  console.log('\n5. Testing GET /tasks without token...');
  const noTokenRes = await fetch(`${BASE_URL}/tasks`);
  console.log(`   Status: ${noTokenRes.status}`);
  if (noTokenRes.status !== 401) throw new Error(`Expected 401 got ${noTokenRes.status}`);

  // Test 6: GET /tasks with invalid token
  console.log('\n6. Testing GET /tasks with invalid token...');
  const invalidTokenRes = await fetch(`${BASE_URL}/tasks`, {
    headers: { 'Authorization': 'Bearer invalid_garbage_token' }
  });
  console.log(`   Status: ${invalidTokenRes.status}`);
  if (invalidTokenRes.status !== 401) throw new Error(`Expected 401 got ${invalidTokenRes.status}`);

  // Test 7: GET /tasks with valid token
  console.log('\n7. Testing GET /tasks with valid Bearer token...');
  const tasksRes = await fetch(`${BASE_URL}/tasks`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  console.log(`   Status: ${tasksRes.status}`);
  const tasksData = await tasksRes.json();
  console.log(`   Found ${tasksData.length} tasks`);
  if (tasksRes.status !== 200 || !Array.isArray(tasksData)) throw new Error('GET /tasks failed with valid token');

  // Test 8: POST /tasks with valid token
  console.log('\n8. Testing POST /tasks with valid token...');
  const createTaskRes = await fetch(`${BASE_URL}/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
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
  if (createTaskRes.status !== 201 || !createdTask.id) throw new Error('POST /tasks failed');
  createdTaskId = createdTask.id;

  // Test 9: PUT /tasks/:id with valid token
  console.log('\n9. Testing PUT /tasks/:id with valid token...');
  const updateTaskRes = await fetch(`${BASE_URL}/tasks/${createdTaskId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({
      title: 'Practical 7 Verification Task Updated',
      description: 'Updated description',
      completed: true,
      priority: 'low'
    })
  });
  console.log(`   Status: ${updateTaskRes.status}`);
  const updatedTask = await updateTaskRes.json();
  console.log('   Updated Task:', updatedTask);
  if (updateTaskRes.status !== 200 || updatedTask.title !== 'Practical 7 Verification Task Updated') {
    throw new Error('PUT /tasks/:id failed');
  }

  // Test 10: GET /tasks/:id with valid token
  console.log('\n10. Testing GET /tasks/:id with valid token...');
  const getSingleTaskRes = await fetch(`${BASE_URL}/tasks/${createdTaskId}`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  console.log(`   Status: ${getSingleTaskRes.status}`);
  const singleTask = await getSingleTaskRes.json();
  if (getSingleTaskRes.status !== 200 || singleTask.id !== createdTaskId) throw new Error('GET /tasks/:id failed');

  // Test 11: DELETE /tasks/:id with valid token
  console.log('\n11. Testing DELETE /tasks/:id with valid token...');
  const deleteTaskRes = await fetch(`${BASE_URL}/tasks/${createdTaskId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  console.log(`   Status: ${deleteTaskRes.status}`);
  if (deleteTaskRes.status !== 200) throw new Error('DELETE /tasks/:id failed');

  // Test 12 & 13: GET /me with valid token
  console.log('\n12 & 13. Testing GET /me with valid token...');
  const meRes = await fetch(`${BASE_URL}/me`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  console.log(`   Status: ${meRes.status}`);
  const meData = await meRes.json();
  console.log('   User Profile:', meData);
  if (meRes.status !== 200 || meData.email !== testUser.email) throw new Error('GET /me failed');
  if (meData.password) throw new Error('GET /me exposed password!');

  // Test 14: Server stability test with malformed JWT
  console.log('\n14. Testing server stability with malformed JWT...');
  const malformedRes = await fetch(`${BASE_URL}/tasks`, {
    headers: { 'Authorization': 'Bearer malformed.jwt.payload' }
  });
  console.log(`   Status: ${malformedRes.status}`);
  if (malformedRes.status !== 401) throw new Error('Malformed token did not return 401');

  // Test 15: Expired token
  console.log('\n15. Testing expired token...');
  const expiredToken = jwt.sign({ id: dbUser ? dbUser._id : 'dummy' }, JWT_SECRET, { expiresIn: '0s' });
  const expiredRes = await fetch(`${BASE_URL}/tasks`, {
    headers: { 'Authorization': `Bearer ${expiredToken}` }
  });
  console.log(`   Status: ${expiredRes.status}`);
  if (expiredRes.status !== 401) throw new Error('Expired token did not return 401');

  console.log('\n==================================================');
  console.log(' ALL 15 BACKEND TESTS PASSED SUCCESSFULLY! ');
  console.log('==================================================\n');
}

runTests().catch((err) => {
  console.error('\n TEST FAILED:', err.message);
  process.exit(1);
});
