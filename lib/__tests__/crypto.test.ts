/**
 * Tests for lib/crypto.ts
 *
 * Coverage:
 *   - Round-trip encrypt/decrypt
 *   - Different ciphertexts for same plaintext (semantic security)
 *   - Tampering detection (auth tag mismatch throws)
 *   - rotate() preserves plaintext under new key
 *   - ciphertextsHaveSamePlaintext helper
 *   - Missing/short SENTRA_ENCRYPTION_KEY throws
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encrypt,
  decrypt,
  rotate,
  ciphertextsHaveSamePlaintext,
} from '@/lib/crypto';

const VALID_KEY_A =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VALID_KEY_B =
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

describe('crypto', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.SENTRA_ENCRYPTION_KEY;
    process.env.SENTRA_ENCRYPTION_KEY = VALID_KEY_A;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.SENTRA_ENCRYPTION_KEY;
    } else {
      process.env.SENTRA_ENCRYPTION_KEY = originalKey;
    }
  });

  describe('encrypt + decrypt round-trip', () => {
    it('decrypts back to the original plaintext', () => {
      const plaintext = 'sk_live_abc123_my_secret_api_key';
      const ciphertext = encrypt(plaintext);
      expect(decrypt(ciphertext)).toBe(plaintext);
    });

    it('handles unicode plaintexts', () => {
      const plaintext = '🔐 clé secrète avec émojis 日本語';
      expect(decrypt(encrypt(plaintext))).toBe(plaintext);
    });

    it('handles empty string', () => {
      expect(decrypt(encrypt(''))).toBe('');
    });

    it('handles long plaintext', () => {
      const plaintext = 'x'.repeat(10_000);
      expect(decrypt(encrypt(plaintext))).toBe(plaintext);
    });
  });

  describe('semantic security', () => {
    it('produces different ciphertexts for the same plaintext', () => {
      const plaintext = 'same_input_every_time';
      const a = encrypt(plaintext);
      const b = encrypt(plaintext);
      // Salt + IV are randomized, so ciphertexts must differ.
      expect(a).not.toBe(b);
      // But both still decrypt to the same plaintext.
      expect(decrypt(a)).toBe(plaintext);
      expect(decrypt(b)).toBe(plaintext);
    });
  });

  describe('tampering detection', () => {
    it('throws when ciphertext bytes are flipped', () => {
      const ciphertext = encrypt('payload');
      // Flip one byte in the encrypted portion (after salt+iv+tag prefix = 44 bytes)
      const buf = Buffer.from(ciphertext, 'base64');
      buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff;
      const tampered = buf.toString('base64');
      expect(() => decrypt(tampered)).toThrow();
    });

    it('throws when auth tag is altered', () => {
      const ciphertext = encrypt('payload');
      const buf = Buffer.from(ciphertext, 'base64');
      // Auth tag occupies bytes 28-44 (after salt:16 + iv:12). Flip one bit in it.
      buf[30] = buf[30] ^ 0x01;
      const tampered = buf.toString('base64');
      expect(() => decrypt(tampered)).toThrow();
    });

    it('throws on truncated ciphertext', () => {
      const ciphertext = encrypt('payload');
      const truncated = ciphertext.slice(0, 10);
      expect(() => decrypt(truncated)).toThrow(/too short|corrupted/i);
    });

    it('throws when decrypting under a different key', () => {
      const ciphertext = encrypt('payload');
      process.env.SENTRA_ENCRYPTION_KEY = VALID_KEY_B;
      expect(() => decrypt(ciphertext)).toThrow();
    });
  });

  describe('rotate', () => {
    it('re-encrypts under a new key, preserves plaintext', () => {
      const plaintext = 'api_key_to_rotate';
      const oldCipher = encrypt(plaintext);
      const newCipher = rotate(oldCipher, VALID_KEY_A, VALID_KEY_B);

      // Old ciphertext still decrypts under VALID_KEY_A
      expect(decrypt(oldCipher)).toBe(plaintext);

      // New ciphertext decrypts under VALID_KEY_B
      process.env.SENTRA_ENCRYPTION_KEY = VALID_KEY_B;
      expect(decrypt(newCipher)).toBe(plaintext);
    });

    it('throws if old key is wrong', () => {
      const cipher = encrypt('payload');
      expect(() => rotate(cipher, VALID_KEY_B, VALID_KEY_A)).toThrow();
    });
  });

  describe('ciphertextsHaveSamePlaintext', () => {
    it('returns true for two ciphertexts of the same plaintext', () => {
      const a = encrypt('hello');
      const b = encrypt('hello');
      expect(ciphertextsHaveSamePlaintext(a, b)).toBe(true);
    });

    it('returns false for different plaintexts', () => {
      const a = encrypt('hello');
      const b = encrypt('world');
      expect(ciphertextsHaveSamePlaintext(a, b)).toBe(false);
    });

    it('returns false on malformed input', () => {
      const a = encrypt('hello');
      expect(ciphertextsHaveSamePlaintext(a, 'not-base64-cipher')).toBe(false);
    });
  });

  describe('env var validation', () => {
    it('throws when SENTRA_ENCRYPTION_KEY is missing', () => {
      delete process.env.SENTRA_ENCRYPTION_KEY;
      expect(() => encrypt('x')).toThrow(/SENTRA_ENCRYPTION_KEY/);
    });

    it('throws when SENTRA_ENCRYPTION_KEY is too short', () => {
      process.env.SENTRA_ENCRYPTION_KEY = 'short';
      expect(() => encrypt('x')).toThrow(/at least 32/);
    });
  });
});
