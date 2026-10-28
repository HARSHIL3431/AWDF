import crypto from 'node:crypto';

/**
 * AES-256-GCM authenticated encryption for background-job payloads.
 *
 * - Key: exactly 64 hex characters (32 bytes) from JOB_PAYLOAD_ENCRYPTION_KEY.
 * - Fresh cryptographically random 12-byte IV for every encryption operation.
 * - Envelope: { v, iv, tag, ct } (base64) persisted with the job document.
 * - AAD binds the ciphertext to its purpose (job type) and format version.
 * - No plaintext fallback exists: any validation or auth failure throws.
 * - Error messages never contain the key, plaintext, or raw cipher material.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BYTES = 16;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
export const PAYLOAD_VERSION = 1;

export class PayloadEncryptionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PayloadEncryptionError';
  }
}

/** Validates key material and returns the raw 32-byte key. Throws with a safe message otherwise. */
export function parseEncryptionKey(keyMaterial) {
  if (typeof keyMaterial !== 'string' || !KEY_HEX_PATTERN.test(keyMaterial.trim())) {
    throw new PayloadEncryptionError(
      'Invalid encryption key format: JOB_PAYLOAD_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes). ' +
        'Generate one with: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))" ' +
        'and place it in backend/.env. The key value itself is never echoed.'
    );
  }
  const key = Buffer.from(keyMaterial.trim(), 'hex');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new PayloadEncryptionError('Invalid encryption key length: expected 32 bytes.');
  }
  return key;
}

/**
 * Reads and validates JOB_PAYLOAD_ENCRYPTION_KEY from the given environment
 * (defaults to process.env). Returns the validated 64-char hex string.
 * Never prints or returns anything derived from an invalid secret.
 */
export function loadEncryptionKey(env = process.env) {
  const raw = env.JOB_PAYLOAD_ENCRYPTION_KEY;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    throw new PayloadEncryptionError(
      'JOB_PAYLOAD_ENCRYPTION_KEY is not configured. Generate a 32-byte key with: ' +
        'node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))" ' +
        'and add it to backend/.env before starting the server.'
    );
  }
  parseEncryptionKey(String(raw));
  return String(raw).trim();
}

function buildAad(purpose) {
  return Buffer.from(`${purpose}|v${PAYLOAD_VERSION}`, 'utf8');
}

function decodeField(value, label, expectedLength) {
  if (typeof value !== 'string' || !BASE64_PATTERN.test(value)) {
    throw new PayloadEncryptionError(`Encrypted payload is malformed: ${label} is not valid base64.`);
  }
  const buf = Buffer.from(value, 'base64');
  if (expectedLength !== undefined && buf.length !== expectedLength) {
    throw new PayloadEncryptionError(`Encrypted payload is malformed: ${label} has an invalid length.`);
  }
  if (expectedLength === undefined && buf.length === 0) {
    throw new PayloadEncryptionError(`Encrypted payload is malformed: ${label} is empty.`);
  }
  return buf;
}

/**
 * Creates a cipher bound to one stable key.
 * encrypt(payload, purpose) -> { v, iv, tag, ct } (all metadata/base64)
 * decrypt(envelope, purpose) -> payload object; throws PayloadEncryptionError on
 * any tampering, wrong purpose, unsupported version, or malformed envelope.
 */
export function createPayloadCipher(keyMaterial) {
  const key = parseEncryptionKey(keyMaterial);

  return {
    encrypt(payload, purpose) {
      if (typeof purpose !== 'string' || purpose.length === 0) {
        throw new PayloadEncryptionError('Encryption purpose is required.');
      }
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new PayloadEncryptionError('Payload must be a plain object.');
      }
      const iv = crypto.randomBytes(IV_LENGTH_BYTES);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH_BYTES });
      cipher.setAAD(buildAad(purpose));
      const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
      const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return {
        v: PAYLOAD_VERSION,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ct: ct.toString('base64'),
      };
    },

    decrypt(envelope, purpose) {
      if (typeof purpose !== 'string' || purpose.length === 0) {
        throw new PayloadEncryptionError('Encryption purpose is required.');
      }
      if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
        throw new PayloadEncryptionError('Encrypted payload is malformed: expected an envelope object.');
      }
      if (envelope.v !== PAYLOAD_VERSION) {
        throw new PayloadEncryptionError(
          `Unsupported payload version: ${String(envelope.v)} (supported: ${PAYLOAD_VERSION}).`
        );
      }
      const iv = decodeField(envelope.iv, 'iv', IV_LENGTH_BYTES);
      const tag = decodeField(envelope.tag, 'tag', TAG_LENGTH_BYTES);
      const ct = decodeField(envelope.ct, 'ct');

      try {
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH_BYTES });
        decipher.setAAD(buildAad(purpose));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
        const parsed = JSON.parse(plaintext.toString('utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new PayloadEncryptionError('Decrypted payload is not an object.');
        }
        return parsed;
      } catch (err) {
        if (err instanceof PayloadEncryptionError) {
          throw err;
        }
        // Authentication failed (tamper / wrong purpose / wrong key) or invalid JSON.
        // Never surface low-level crypto or plaintext details.
        throw new PayloadEncryptionError(
          'Payload decryption failed: ciphertext is invalid, was tampered with, or was encrypted for a different purpose or key.'
        );
      }
    },
  };
}

let defaultCipher = null;

/** Lazy env-backed cipher. Created on first use, validated once, stable across restarts. */
export function getPayloadCipher() {
  if (defaultCipher === null) {
    defaultCipher = createPayloadCipher(loadEncryptionKey());
  }
  return defaultCipher;
}
