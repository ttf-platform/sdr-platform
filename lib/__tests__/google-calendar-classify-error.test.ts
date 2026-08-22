/**
 * lib/__tests__/google-calendar-classify-error.test.ts
 *
 * LC21 (4)A — classifyError, fonction pure.
 */

import { describe, it, expect } from 'vitest';
import { classifyError } from '@/lib/google-calendar-client';

describe('LC21 (4)A — classifyError', () => {
  it('409 => deja_present (jamais un succes en soi — I5)', () => {
    expect(classifyError({ status: 409, reason: null })).toBe('deja_present');
    expect(classifyError({ status: 409, reason: 'duplicate' })).toBe('deja_present');
  });

  it('rejouable : 429, 5xx, 403 rateLimitExceeded / userRateLimitExceeded', () => {
    expect(classifyError({ status: 429, reason: null })).toBe('rejouable');
    expect(classifyError({ status: 500, reason: null })).toBe('rejouable');
    expect(classifyError({ status: 502, reason: null })).toBe('rejouable');
    expect(classifyError({ status: 503, reason: null })).toBe('rejouable');
    expect(classifyError({ status: 599, reason: null })).toBe('rejouable');
    expect(classifyError({ status: 403, reason: 'rateLimitExceeded' })).toBe('rejouable');
    expect(classifyError({ status: 403, reason: 'userRateLimitExceeded' })).toBe('rejouable');
  });

  it('permanent : 400, 401, autres 403, 404 (ECART assume)', () => {
    expect(classifyError({ status: 400, reason: null })).toBe('permanent');
    expect(classifyError({ status: 401, reason: null })).toBe('permanent');
    expect(classifyError({ status: 403, reason: 'insufficientPermissions' })).toBe('permanent');
    expect(classifyError({ status: 403, reason: 'forbiddenForNonOrganizer' })).toBe('permanent');
    expect(classifyError({ status: 403, reason: null })).toBe('permanent');
    // ECART DECLARE : Google range 404 en rejouable ; sur insertion, c'est une
    // configuration. Classe permanent.
    expect(classifyError({ status: 404, reason: null })).toBe('permanent');
  });

  it('I6 : status 200 + reason "id_mismatch" => permanent', () => {
    expect(classifyError({ status: 200, reason: 'id_mismatch' })).toBe('permanent');
  });

  it('statut inconnu ou reason absent : permanent — une classification qui ne sait pas ne reessaie pas', () => {
    expect(classifyError({ status: 418, reason: null })).toBe('permanent');
    expect(classifyError({ status: 0, reason: null })).toBe('permanent');
    expect(classifyError({ status: 999, reason: 'nope' })).toBe('permanent');
  });
});
