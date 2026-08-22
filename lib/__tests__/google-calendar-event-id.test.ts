/**
 * lib/__tests__/google-calendar-event-id.test.ts
 *
 * LC21 (4)A — tests PURS de la derivation et de la validation.
 * Aucun reseau, aucune base.
 */

import { describe, it, expect } from 'vitest';
import {
  GOOGLE_EVENT_ID_PREFIX,
  deriveGoogleEventId,
  isValidGoogleEventId,
} from '@/lib/google-calendar-event-id';

describe('LC21 (4)A — GOOGLE_EVENT_ID_PREFIX', () => {
  it('vaut litteralement "mirvo" — I2 : irreversible, une seule constante', () => {
    expect(GOOGLE_EVENT_ID_PREFIX).toBe('mirvo');
  });
});

describe('LC21 (4)A — isValidGoogleEventId', () => {
  it('accepte le jeu a-v et 0-9, longueur dans [5, 1024]', () => {
    expect(isValidGoogleEventId('abcde')).toBe(true);
    expect(isValidGoogleEventId('a'.repeat(1024))).toBe(true);
    expect(isValidGoogleEventId('mirvoabcdef0123456789abcdef01234567')).toBe(true);
  });

  it('refuse les caracteres hors [a-v0-9]', () => {
    expect(isValidGoogleEventId('mirvoWXYZ0123456789abcdef01234567abc')).toBe(false); // W,X,Y,Z hors [a-v]
    expect(isValidGoogleEventId('mirvo-abcdef')).toBe(false);
    expect(isValidGoogleEventId('mirvo_abcdef')).toBe(false);
    expect(isValidGoogleEventId('MIRVOABCDEF012345')).toBe(false); // majuscules refusees
    expect(isValidGoogleEventId('mirvo!@#')).toBe(false);
    expect(isValidGoogleEventId('mirvoz')).toBe(false); // z hors [a-v]
  });

  it('refuse les longueurs hors [5, 1024]', () => {
    expect(isValidGoogleEventId('')).toBe(false);
    expect(isValidGoogleEventId('a')).toBe(false);
    expect(isValidGoogleEventId('abcd')).toBe(false);
    expect(isValidGoogleEventId('a'.repeat(1025))).toBe(false);
  });

  it('refuse les entrees non-chaine', () => {
    // @ts-expect-error test defensif
    expect(isValidGoogleEventId(123)).toBe(false);
    // @ts-expect-error test defensif
    expect(isValidGoogleEventId(null)).toBe(false);
  });
});

describe('LC21 (4)A — deriveGoogleEventId — I1, I2', () => {
  const UUID = '0f2a3b4c-5d6e-7f89-8a90-1b2c3d4e5f60';

  it('est deterministe : deux appels sur la meme entree rendent la meme sortie (I1)', () => {
    const a = deriveGoogleEventId(UUID);
    const b = deriveGoogleEventId(UUID);
    expect(a).toBe(b);
  });

  it('produit "mirvo" + 32 hex sans tirets, longueur 37 (I2)', () => {
    const id = deriveGoogleEventId(UUID);
    expect(id.startsWith('mirvo')).toBe(true);
    expect(id.length).toBe(37);
    expect(id).toBe('mirvo0f2a3b4c5d6e7f898a901b2c3d4e5f60');
  });

  it('normalise la casse — un uuid en MAJUSCULES est accepte et rend le meme id (I2)', () => {
    const upper = UUID.toUpperCase();
    expect(deriveGoogleEventId(upper)).toBe(deriveGoogleEventId(UUID));
  });

  it('appelle isValidGoogleEventId sur le resultat (contrat Google)', () => {
    const id = deriveGoogleEventId(UUID);
    expect(isValidGoogleEventId(id)).toBe(true);
  });

  it('refuse un uuid malforme — leve explicitement, aucun repli', () => {
    expect(() => deriveGoogleEventId('not-a-uuid')).toThrow();
    expect(() => deriveGoogleEventId('0f2a3b4c-5d6e-7f89-8a90-1b2c3d4e5f6')).toThrow();  // trop court
    expect(() => deriveGoogleEventId('0f2a3b4c5d6e7f898a901b2c3d4e5f60')).toThrow();     // sans tirets
    expect(() => deriveGoogleEventId('gggggggg-5d6e-7f89-8a90-1b2c3d4e5f60')).toThrow(); // g hors [0-9a-f]
    // @ts-expect-error test defensif
    expect(() => deriveGoogleEventId(null)).toThrow();
  });
});
