/**
 * lib/__tests__/google-calendar-sync-decision.test.ts
 *
 * LC21 (4)A — deux decideurs purs : decideAfterConflict + nextSyncState.
 * Aucun reseau, aucune base.
 */

import { describe, it, expect } from 'vitest';
import type { GoogleEventPayload } from '@/lib/google-calendar-client';
import {
  decideAfterConflict,
  nextSyncState,
  RETRY_BASE_SECONDS,
  RETRY_FACTOR,
  RETRY_MAX_ATTEMPTS,
} from '@/lib/google-calendar-sync-decision';

const WS  = '11111111-1111-1111-1111-111111111111';
const MTG = '22222222-2222-2222-2222-222222222222';
const ENV = 'wcpwzhkcvgwthgjhbgbf';

function baseEvent(overrides: Partial<GoogleEventPayload> = {}): GoogleEventPayload {
  return {
    id: 'mirvo00000000000000000000000000000000',
    status: 'confirmed',
    start: { dateTime: '2026-09-01T10:00:00.000Z', timeZone: 'Europe/Paris' },
    end:   { dateTime: '2026-09-01T11:00:00.000Z', timeZone: 'Europe/Paris' },
    extendedProperties: {
      private: {
        mirvo_workspace_id:    WS,
        mirvo_meeting_id:      MTG,
        mirvo_environment_ref: ENV,
      },
    },
    ...overrides,
  };
}

const EXPECT = {
  expectedWorkspaceId:    WS,
  expectedMeetingId:      MTG,
  expectedEnvironmentRef: ENV,
  expectedStartsAt:       '2026-09-01T10:00:00.000Z',
  expectedEndsAt:         '2026-09-01T11:00:00.000Z',
};

// ─── decideAfterConflict ────────────────────────────────────────────────────

describe('LC21 (4)A — decideAfterConflict — I5, quatre conditions cumulatives', () => {
  it('nominal — les quatre conditions reunies => synced', () => {
    const r = decideAfterConflict({ fetchedEvent: baseEvent(), ...EXPECT });
    expect(r).toEqual({ verdict: 'synced' });
  });

  it('adversarial 1 — evenement etranger (aucun marqueur) => failed missing_ownership_marker', () => {
    const r = decideAfterConflict({
      fetchedEvent: baseEvent({ extendedProperties: undefined }),
      ...EXPECT,
    });
    expect(r).toEqual({ verdict: 'failed', reason: 'missing_ownership_marker' });
  });

  it('adversarial 2 — autre environnement (mauvais discriminant) => failed environment_mismatch', () => {
    const r = decideAfterConflict({
      fetchedEvent: baseEvent({
        extendedProperties: { private: { mirvo_workspace_id: WS, mirvo_meeting_id: MTG, mirvo_environment_ref: 'grrzisdrhstuzrohlgla' } },
      }),
      ...EXPECT,
    });
    expect(r).toEqual({ verdict: 'failed', reason: 'environment_mismatch' });
  });

  it('adversarial 3 — autre workspace => failed workspace_mismatch', () => {
    const other = '33333333-3333-3333-3333-333333333333';
    const r = decideAfterConflict({
      fetchedEvent: baseEvent({
        extendedProperties: { private: { mirvo_workspace_id: other, mirvo_meeting_id: MTG, mirvo_environment_ref: ENV } },
      }),
      ...EXPECT,
    });
    expect(r).toEqual({ verdict: 'failed', reason: 'workspace_mismatch' });
  });

  it('adversarial 4 — status = cancelled => failed status_cancelled (atteignable, get retourne les annules)', () => {
    const r = decideAfterConflict({ fetchedEvent: baseEvent({ status: 'cancelled' }), ...EXPECT });
    expect(r).toEqual({ verdict: 'failed', reason: 'status_cancelled' });
  });

  it('adversarial 5 — bon id, mauvais creneau => failed time_mismatch', () => {
    const r = decideAfterConflict({
      fetchedEvent: baseEvent({
        start: { dateTime: '2026-09-01T10:00:00.000Z' },
        end:   { dateTime: '2026-09-01T11:30:00.000Z' }, // +30 min
      }),
      ...EXPECT,
    });
    expect(r).toEqual({ verdict: 'failed', reason: 'time_mismatch' });
  });

  it('adversarial 8 — deux representations d\'un meme instant sont EGALES (representation-vs-instant)', () => {
    // 10:00Z == 12:00+02:00 (Europe/Paris ete). Attendu synced.
    const r = decideAfterConflict({
      fetchedEvent: baseEvent({
        start: { dateTime: '2026-09-01T12:00:00+02:00' },
        end:   { dateTime: '2026-09-01T13:00:00+02:00' },
      }),
      ...EXPECT,
    });
    expect(r).toEqual({ verdict: 'synced' });
  });

  it('adversarial — meeting mismatch => failed meeting_mismatch', () => {
    const other = '99999999-9999-9999-9999-999999999999';
    const r = decideAfterConflict({
      fetchedEvent: baseEvent({
        extendedProperties: { private: { mirvo_workspace_id: WS, mirvo_meeting_id: other, mirvo_environment_ref: ENV } },
      }),
      ...EXPECT,
    });
    expect(r).toEqual({ verdict: 'failed', reason: 'meeting_mismatch' });
  });

  it('adversarial — start.dateTime absent (all-day, cas hors produit) => failed unreadable_time', () => {
    const r = decideAfterConflict({
      fetchedEvent: baseEvent({ start: { date: '2026-09-01' }, end: { date: '2026-09-02' } }),
      ...EXPECT,
    });
    expect(r).toEqual({ verdict: 'failed', reason: 'unreadable_time' });
  });

  it('adversarial — comparaison en INSTANTS : chaine differente / meme instant => synced', () => {
    const r = decideAfterConflict({
      fetchedEvent: baseEvent({
        start: { dateTime: '2026-09-01T10:00:00Z' },   // sans .000
        end:   { dateTime: '2026-09-01T11:00:00Z' },
      }),
      ...EXPECT,
    });
    expect(r).toEqual({ verdict: 'synced' });
  });
});

// ─── nextSyncState ──────────────────────────────────────────────────────────

describe('LC21 (4)A — nextSyncState — regle d\'etat prescrite', () => {
  const NOW = new Date('2026-09-01T00:00:00.000Z');

  it('succes => synced + next_attempt_at NULL', () => {
    expect(nextSyncState({ kind: 'success', attemptsSoFar: 1, now: NOW })).toEqual({
      sync_status: 'synced', attempts: 1, next_attempt_at: null,
    });
    expect(nextSyncState({ kind: 'success', attemptsSoFar: 5, now: NOW })).toEqual({
      sync_status: 'synced', attempts: 5, next_attempt_at: null,
    });
  });

  it('rejouable sous plafond => failed + prochaine tentative (backoff exponentiel)', () => {
    const r = nextSyncState({ kind: 'insertError', errorClass: 'rejouable', attemptsSoFar: 1, now: NOW });
    expect(r.sync_status).toBe('failed');
    expect(r.attempts).toBe(1);
    // n=1 => base * factor^0 = base
    const expected = new Date(NOW.getTime() + RETRY_BASE_SECONDS * 1000).toISOString();
    expect(r.next_attempt_at).toBe(expected);
  });

  it('backoff exponentiel : n=3 => base * factor^2', () => {
    const r = nextSyncState({ kind: 'insertError', errorClass: 'rejouable', attemptsSoFar: 3, now: NOW });
    const seconds = RETRY_BASE_SECONDS * Math.pow(RETRY_FACTOR, 2);
    expect(r.next_attempt_at).toBe(new Date(NOW.getTime() + seconds * 1000).toISOString());
  });

  it('rejouable, plafond atteint => failed_permanent + next_attempt_at NULL (I14)', () => {
    const r = nextSyncState({ kind: 'insertError', errorClass: 'rejouable', attemptsSoFar: RETRY_MAX_ATTEMPTS, now: NOW });
    expect(r).toEqual({
      sync_status: 'failed_permanent', attempts: RETRY_MAX_ATTEMPTS, next_attempt_at: null,
    });
  });

  it('permanent => failed_permanent + NULL, sans se preoccuper du nombre de tentatives', () => {
    expect(nextSyncState({ kind: 'insertError', errorClass: 'permanent', attemptsSoFar: 1, now: NOW })).toEqual({
      sync_status: 'failed_permanent', attempts: 1, next_attempt_at: null,
    });
  });

  it('409 verifie incompatible => failed_permanent + NULL (lecture ABOUTIE prouve incompatibilite)', () => {
    expect(nextSyncState({ kind: 'conflictVerifiedIncompatible', attemptsSoFar: 1, now: NOW })).toEqual({
      sync_status: 'failed_permanent', attempts: 1, next_attempt_at: null,
    });
  });

  it('adversarial 6a — 409 puis lecture en 429/5xx (rejouable) => failed AVEC prochaine tentative, JAMAIS failed_permanent', () => {
    const r = nextSyncState({ kind: 'conflictVerifyError', errorClass: 'rejouable', attemptsSoFar: 1, now: NOW });
    expect(r.sync_status).toBe('failed');
    expect(r.next_attempt_at).not.toBeNull();
  });

  it('adversarial 6b — 409 puis lecture en erreur PERMANENTE => failed_permanent', () => {
    const r = nextSyncState({ kind: 'conflictVerifyError', errorClass: 'permanent', attemptsSoFar: 1, now: NOW });
    expect(r).toEqual({ sync_status: 'failed_permanent', attempts: 1, next_attempt_at: null });
  });

  it('adversarial — 409 + lecture rejouable, plafond atteint => failed_permanent', () => {
    const r = nextSyncState({ kind: 'conflictVerifyError', errorClass: 'rejouable', attemptsSoFar: RETRY_MAX_ATTEMPTS, now: NOW });
    expect(r.sync_status).toBe('failed_permanent');
    expect(r.next_attempt_at).toBeNull();
  });
});
