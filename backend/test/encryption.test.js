import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  PayloadEncryptionError,
  createPayloadCipher,
  loadEncryptionKey,
  parseEncryptionKey,
  PAYLOAD_VERSION,
} from '../src/security/payloadEncryption.js';
import { EMAIL_JOB_PURPOSE } from '../src/config/jobConfig.js';

// Ephemeral test-only key. Never a production key; generated per run in-process.
const TEST_KEY = crypto.randomBytes(32).toString('hex');
const OTHER_KEY = crypto.randomBytes(32).toString('hex');

const PAYLOAD = {
  email: 'recipient@example.com',
  resetToken: crypto.randomBytes(32).toString('hex'),
  frontendUrl: 'http://localhost:5173',
};

test('round trip: encrypt then decrypt returns the original payload', () => {
  const cipher = createPayloadCipher(TEST_KEY);
  const envelope = cipher.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE);
  const decrypted = cipher.decrypt(envelope, EMAIL_JOB_PURPOSE);
  assert.deepEqual(decrypted, PAYLOAD);
});

test('envelope carries version, iv, tag, and ciphertext with correct sizes', () => {
  const cipher = createPayloadCipher(TEST_KEY);
  const envelope = cipher.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE);
  assert.equal(envelope.v, PAYLOAD_VERSION);
  assert.equal(Buffer.from(envelope.iv, 'base64').length, 12); // GCM nonce
  assert.equal(Buffer.from(envelope.tag, 'base64').length, 16); // auth tag
  assert.ok(Buffer.from(envelope.ct, 'base64').length > 0);
});

test('a fresh nonce is used for every encryption of the same payload', () => {
  const cipher = createPayloadCipher(TEST_KEY);
  const a = cipher.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE);
  const b = cipher.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('no plaintext token appears anywhere in the serialized envelope', () => {
  const cipher = createPayloadCipher(TEST_KEY);
  const envelope = cipher.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE);
  const serialized = JSON.stringify(envelope);
  assert.ok(!serialized.includes(PAYLOAD.resetToken));
  assert.ok(!serialized.includes(PAYLOAD.email));
});

test('decryption with a different key fails with a safe error', () => {
  const a = createPayloadCipher(TEST_KEY);
  const b = createPayloadCipher(OTHER_KEY);
  const envelope = a.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE);
  assert.throws(() => b.decrypt(envelope, EMAIL_JOB_PURPOSE), PayloadEncryptionError);
});

test('tampered ciphertext is rejected (authentication fails)', () => {
  const cipher = createPayloadCipher(TEST_KEY);
  const envelope = cipher.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE);
  const ct = Buffer.from(envelope.ct, 'base64');
  ct[0] ^= 0xff;
  const tampered = { ...envelope, ct: ct.toString('base64') };
  assert.throws(() => cipher.decrypt(tampered, EMAIL_JOB_PURPOSE), PayloadEncryptionError);
});

test('tampered authentication tag is rejected', () => {
  const cipher = createPayloadCipher(TEST_KEY);
  const envelope = cipher.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE);
  const tag = Buffer.from(envelope.tag, 'base64');
  tag[0] ^= 0xff;
  const tampered = { ...envelope, tag: tag.toString('base64') };
  assert.throws(() => cipher.decrypt(tampered, EMAIL_JOB_PURPOSE), PayloadEncryptionError);
});

test('tampered iv is rejected', () => {
  const cipher = createPayloadCipher(TEST_KEY);
  const envelope = cipher.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE);
  const iv = Buffer.from(envelope.iv, 'base64');
  iv[0] ^= 0xff;
  const tampered = { ...envelope, iv: iv.toString('base64') };
  assert.throws(() => cipher.decrypt(tampered, EMAIL_JOB_PURPOSE), PayloadEncryptionError);
});

test('wrong purpose (AAD mismatch) is rejected', () => {
  const cipher = createPayloadCipher(TEST_KEY);
  const envelope = cipher.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE);
  assert.throws(() => cipher.decrypt(envelope, 'email.some_other_job'), PayloadEncryptionError);
});

test('unsupported payload version is rejected', () => {
  const cipher = createPayloadCipher(TEST_KEY);
  const envelope = cipher.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE);
  assert.throws(
    () => cipher.decrypt({ ...envelope, v: 99 }, EMAIL_JOB_PURPOSE),
    /Unsupported payload version/
  );
});

test('malformed envelopes are rejected without leaking internals', () => {
  const cipher = createPayloadCipher(TEST_KEY);
  for (const bad of [null, undefined, 'string', [], {}, { v: PAYLOAD_VERSION }]) {
    assert.throws(() => cipher.decrypt(bad, EMAIL_JOB_PURPOSE), PayloadEncryptionError);
  }
  // invalid base64 fields
  const base = cipher.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE);
  assert.throws(() => cipher.decrypt({ ...base, iv: '!!!not-base64!!!' }, EMAIL_JOB_PURPOSE), PayloadEncryptionError);
  assert.throws(() => cipher.decrypt({ ...base, tag: 'AAAA' }, EMAIL_JOB_PURPOSE), PayloadEncryptionError);
});

test('errors never contain the key, plaintext token, or ciphertext', () => {
  const cipher = createPayloadCipher(TEST_KEY);
  const envelope = cipher.encrypt(PAYLOAD, EMAIL_JOB_PURPOSE);
  const tampered = { ...envelope, tag: Buffer.alloc(16).toString('base64') };
  let message = '';
  try {
    cipher.decrypt(tampered, EMAIL_JOB_PURPOSE);
  } catch (err) {
    message = String(err.message);
  }
  assert.ok(message.length > 0);
  assert.ok(!message.includes(TEST_KEY));
  assert.ok(!message.includes(PAYLOAD.resetToken));
  assert.ok(!message.includes(envelope.ct));
});

test('parseEncryptionKey rejects invalid key formats with remediation text', () => {
  const invalid = ['', 'abc', 'g'.repeat(64), '0'.repeat(63), '0'.repeat(65), 42, null, undefined];
  for (const bad of invalid) {
    assert.throws(() => parseEncryptionKey(bad), PayloadEncryptionError);
  }
  // remediation guidance present, key value never echoed
  let msg = '';
  try {
    parseEncryptionKey('zz'.repeat(10));
  } catch (err) {
    msg = String(err.message);
  }
  assert.match(msg, /64 hexadecimal/i);
  assert.match(msg, /randomBytes/);
  assert.ok(!msg.includes('zz'.repeat(10)));
  assert.equal(parseEncryptionKey('  ' + TEST_KEY + '  ').length, 32); // trims surrounding whitespace
});

test('loadEncryptionKey: missing key fails fast with safe remediation', () => {
  assert.throws(() => loadEncryptionKey({}), (err) => {
    assert.equal(err.name, 'PayloadEncryptionError');
    assert.match(err.message, /JOB_PAYLOAD_ENCRYPTION_KEY is not configured/);
    assert.match(err.message, /randomBytes/);
    return true;
  });
  assert.throws(() => loadEncryptionKey({ JOB_PAYLOAD_ENCRYPTION_KEY: '' }), PayloadEncryptionError);
  assert.throws(() => loadEncryptionKey({ JOB_PAYLOAD_ENCRYPTION_KEY: 'not-a-key' }), PayloadEncryptionError);
});

test('loadEncryptionKey: present valid key is accepted and returned verbatim (trimmed)', () => {
  assert.equal(loadEncryptionKey({ JOB_PAYLOAD_ENCRYPTION_KEY: TEST_KEY }), TEST_KEY);
  const upper = TEST_KEY.toUpperCase();
  assert.equal(loadEncryptionKey({ JOB_PAYLOAD_ENCRYPTION_KEY: upper }), upper);
});

test('loadEncryptionKey: invalid configured key error does not echo the value', () => {
  const bogus = 'nope-not-hex-'.repeat(6);
  let msg = '';
  try {
    loadEncryptionKey({ JOB_PAYLOAD_ENCRYPTION_KEY: bogus });
  } catch (err) {
    msg = String(err.message);
  }
  assert.ok(msg.length > 0);
  assert.ok(!msg.includes(bogus));
});

test('real environment key (if exported) is 64-hex — value never printed', () => {
  const raw = process.env.JOB_PAYLOAD_ENCRYPTION_KEY;
  if (raw === undefined || String(raw).trim() === '') {
    // Not exported to this process: assert the module refuses to proceed.
    assert.throws(() => loadEncryptionKey(process.env), PayloadEncryptionError);
  } else {
    assert.match(String(raw).trim(), /^[0-9a-fA-F]{64}$/);
    assert.equal(loadEncryptionKey(process.env), String(raw).trim());
  }
});
