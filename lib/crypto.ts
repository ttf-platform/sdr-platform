/**
 * lib/crypto.ts
 *
 * AES-256-GCM encryption for sensitive credentials stored in the DB.
 *
 * Used by service_connections to store API keys (Instantly, Clay, etc.) and
 * OAuth refresh tokens (Google Workspace, Microsoft 365).
 *
 * Cipher format (base64-encoded buffer):
 *   [salt:16] [iv:12] [auth_tag:16] [ciphertext:variable]
 *
 * The master passphrase comes from env var SENTRA_ENCRYPTION_KEY.
 * Each encrypt() generates a fresh salt + IV (so encrypting the same plaintext
 * twice produces different ciphertexts — semantic security).
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;       // GCM-recommended
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;      // 256 bits

function getMasterPassphrase(): string {
  const key = process.env.SENTRA_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      '[crypto] SENTRA_ENCRYPTION_KEY env var is not set. ' +
      'Generate one with: openssl rand -hex 32'
    );
  }
  if (key.length < 32) {
    throw new Error(
      '[crypto] SENTRA_ENCRYPTION_KEY must be at least 32 characters'
    );
  }
  return key;
}

function encryptWith(plaintext: string, passphrase: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = scryptSync(passphrase, salt, KEY_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

function decryptWith(ciphertextB64: string, passphrase: string): string {
  const buffer = Buffer.from(ciphertextB64, 'base64');

  if (buffer.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH) {
    throw new Error('[crypto] Ciphertext too short — corrupted or wrong format');
  }

  const salt = buffer.subarray(0, SALT_LENGTH);
  const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = buffer.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + TAG_LENGTH
  );
  const encrypted = buffer.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = scryptSync(passphrase, salt, KEY_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString('utf-8');
}

/**
 * Encrypt a UTF-8 plaintext (e.g. an API key) into a base64 ciphertext blob.
 * Throws if SENTRA_ENCRYPTION_KEY is missing or too short.
 */
export function encrypt(plaintext: string): string {
  return encryptWith(plaintext, getMasterPassphrase());
}

/**
 * Decrypt a base64 ciphertext produced by encrypt() back to its UTF-8 plaintext.
 * Throws on:
 *  - missing/short SENTRA_ENCRYPTION_KEY
 *  - malformed/truncated ciphertext
 *  - GCM auth tag mismatch (= tampered data or wrong key)
 */
export function decrypt(ciphertextB64: string): string {
  return decryptWith(ciphertextB64, getMasterPassphrase());
}

/**
 * Re-encrypt a ciphertext under a new key. Used for key rotation.
 * Operation is atomic: decrypts with old key, encrypts with new — never writes
 * to env or shared state.
 */
export function rotate(
  ciphertextB64: string,
  oldPassphrase: string,
  newPassphrase: string
): string {
  const plaintext = decryptWith(ciphertextB64, oldPassphrase);
  return encryptWith(plaintext, newPassphrase);
}

/**
 * Test helper — compare two ciphertexts of the same plaintext. Returns true if
 * both decrypt successfully under the same key (their plaintexts match).
 *
 * Don't compare ciphertexts directly with === — they will differ each time
 * because of the random salt + IV.
 */
export function ciphertextsHaveSamePlaintext(a: string, b: string): boolean {
  try {
    return decrypt(a) === decrypt(b);
  } catch {
    return false;
  }
}
