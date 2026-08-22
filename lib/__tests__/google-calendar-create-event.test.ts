/**
 * lib/__tests__/google-calendar-create-event.test.ts
 *
 * LC21 (4)A — tests createEvent et getEvent contre DOUBLURE.
 * Aucun appel reseau reel. Un unique OAuth2Client est mocke via
 * google-auth-library ; le reste passe par globalThis.fetch mocke.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const OAUTH_MOCK = {
  OAuth2Client: class {
    setCredentials() {}
    async getAccessToken() { return { token: 'stub-access-token' }; }
    generateAuthUrl() { return ''; }
    async getToken() { return { tokens: {} }; }
    async verifyIdToken() { return { getPayload: () => ({ sub: 's', email: null }) }; }
    async revokeToken() {}
  },
};

vi.mock('google-auth-library', () => OAUTH_MOCK);

// Env minimal pour makeClient()
beforeEach(() => {
  process.env.GOOGLE_CALENDAR_CLIENT_ID     = 'stub-client.apps.googleusercontent.com';
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'stub-secret';
  process.env.GOOGLE_CALENDAR_REDIRECT_URI  = 'https://mirvo.test/api/calendar/google/callback';
});

let fetchCalls: Array<{ url: string; init: RequestInit }>;

function installFetch(responder: (n: number) => { ok: boolean; status: number; json: () => Promise<unknown> }) {
  fetchCalls = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    fetchCalls.push({ url, init: init ?? {} });
    const r = responder(fetchCalls.length);
    return r as unknown as Response;
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

afterEach(() => {
  vi.doUnmock('google-auth-library');
  vi.doMock('google-auth-library', () => OAUTH_MOCK);
});

// ─── createEvent ──────────────────────────────────────────────────────────────

describe('LC21 (4)A — createEvent — charge utile stricte, I3 (sendUpdates=none, aucun attendees), I6, I9', () => {
  it('nominal — 200 avec id egal a eventId demande => rend { eventId }', async () => {
    const eventId = 'mirvo0f2a3b4c5d6e7f898a901b2c3d4e5f60';
    const restore = installFetch(() => ({ ok: true, status: 200, json: async () => ({ id: eventId, status: 'confirmed' }) }));
    try {
      const { createEvent } = await import('@/lib/google-calendar-client');
      const r = await createEvent({
        refreshToken: 'rt', calendarId: 'primary', eventId,
        summary: 'RV', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', timeZone: 'Europe/Paris',
        ownership: { workspaceId: 'WS', meetingId: 'MTG', environmentRef: 'ENV' },
      });
      expect(r.eventId).toBe(eventId); // I9 : (4)A rend l'id derive utilise

      // URL et payload
      const call = fetchCalls[0];
      expect(call.url).toContain('/calendars/primary/events');
      expect(call.url).toContain('sendUpdates=none'); // I3 pose EXPLICITEMENT
      expect(call.init.method).toBe('POST');
      const body = JSON.parse(String(call.init.body));
      expect(body.id).toBe(eventId);
      expect(body.start).toEqual({ dateTime: '2026-09-01T10:00:00Z', timeZone: 'Europe/Paris' });
      expect(body.end).toEqual({   dateTime: '2026-09-01T11:00:00Z', timeZone: 'Europe/Paris' });
      // I3 : aucun attendees dans le body
      expect(body.attendees).toBeUndefined();
      // I4 : marqueur a trois composantes
      expect(body.extendedProperties.private).toEqual({
        mirvo_workspace_id: 'ws',
        mirvo_meeting_id: 'mtg',
        mirvo_environment_ref: 'env',
      });
    } finally { restore(); }
  });

  it('adversarial 12 — la charge utile ne peut jamais contenir attendees (aucune option ne le permet)', async () => {
    const eventId = 'mirvo0f2a3b4c5d6e7f898a901b2c3d4e5f60';
    const restore = installFetch(() => ({ ok: true, status: 200, json: async () => ({ id: eventId }) }));
    try {
      const { createEvent } = await import('@/lib/google-calendar-client');
      await createEvent({
        refreshToken: 'rt', calendarId: 'primary', eventId,
        summary: 'RV', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', timeZone: 'Europe/Paris',
        // @ts-expect-error — la surface ne l'accepte pas ; on prouve qu'un ajout accidentel est aussi refuse par le typage
        attendees: [{ email: 'x@y' }],
        ownership: { workspaceId: 'WS', meetingId: 'MTG', environmentRef: 'ENV' },
      });
      const body = JSON.parse(String(fetchCalls[0].init.body));
      expect(body.attendees).toBeUndefined();
    } finally { restore(); }
  });

  it('adversarial 7 — I6 : 200 mais id rendu != eventId => GoogleApiError(200, id_mismatch)', async () => {
    const eventId = 'mirvo0f2a3b4c5d6e7f898a901b2c3d4e5f60';
    const restore = installFetch(() => ({ ok: true, status: 200, json: async () => ({ id: 'other-id' }) }));
    try {
      const { createEvent, GoogleApiError } = await import('@/lib/google-calendar-client');
      await expect(createEvent({
        refreshToken: 'rt', calendarId: 'primary', eventId,
        summary: 'RV', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', timeZone: 'Europe/Paris',
        ownership: { workspaceId: 'WS', meetingId: 'MTG', environmentRef: 'ENV' },
      })).rejects.toMatchObject({ name: 'GoogleApiError', status: 200, reason: 'id_mismatch' });
      // Preuve du type d'erreur
      try {
        await createEvent({
          refreshToken: 'rt', calendarId: 'primary', eventId,
          summary: 'RV', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', timeZone: 'Europe/Paris',
          ownership: { workspaceId: 'WS', meetingId: 'MTG', environmentRef: 'ENV' },
        });
      } catch (e) {
        expect(e).toBeInstanceOf(GoogleApiError);
      }
    } finally { restore(); }
  });

  it('erreur 409 => GoogleApiError(409, reason)', async () => {
    const restore = installFetch(() => ({
      ok: false, status: 409,
      json: async () => ({ error: { errors: [{ reason: 'duplicate' }] } }),
    }));
    try {
      const { createEvent } = await import('@/lib/google-calendar-client');
      await expect(createEvent({
        refreshToken: 'rt', calendarId: 'primary', eventId: 'mirvoabcdefabcdefabcdefabcdefabcdef01',
        summary: 'RV', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', timeZone: 'Europe/Paris',
        ownership: { workspaceId: 'ws', meetingId: 'mtg', environmentRef: 'env' },
      })).rejects.toMatchObject({ name: 'GoogleApiError', status: 409, reason: 'duplicate' });
    } finally { restore(); }
  });

  it('I8 — la GoogleApiError NE PORTE PAS le corps de reponse (juste status + reason)', async () => {
    const restore = installFetch(() => ({
      ok: false, status: 403,
      json: async () => ({
        error: {
          errors: [{ reason: 'insufficientPermissions', message: 'Calendar owner user@example.com has no write access' }],
          message: 'user@example.com forbidden',
        },
      }),
    }));
    try {
      const { createEvent, GoogleApiError } = await import('@/lib/google-calendar-client');
      try {
        await createEvent({
          refreshToken: 'rt', calendarId: 'primary', eventId: 'mirvoabcdefabcdefabcdefabcdefabcdef01',
          summary: 'RV', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', timeZone: 'Europe/Paris',
          ownership: { workspaceId: 'ws', meetingId: 'mtg', environmentRef: 'env' },
        });
      } catch (e) {
        expect(e).toBeInstanceOf(GoogleApiError);
        // Aucun email n'apparait dans l'erreur exposee.
        expect(String((e as Error).message)).not.toContain('user@example.com');
        expect((e as { reason: string | null }).reason).toBe('insufficientPermissions');
      }
    } finally { restore(); }
  });
});

// ─── getEvent ─────────────────────────────────────────────────────────────────

describe('LC21 (4)A — getEvent', () => {
  it('nominal — rend l\'objet Google avec status et extendedProperties.private', async () => {
    const payload = {
      id: 'mirvoabcdef', status: 'confirmed',
      start: { dateTime: '2026-09-01T10:00:00Z' },
      end:   { dateTime: '2026-09-01T11:00:00Z' },
      extendedProperties: { private: { mirvo_workspace_id: 'ws', mirvo_meeting_id: 'mtg', mirvo_environment_ref: 'env' } },
    };
    const restore = installFetch(() => ({ ok: true, status: 200, json: async () => payload }));
    try {
      const { getEvent } = await import('@/lib/google-calendar-client');
      const r = await getEvent({ refreshToken: 'rt', calendarId: 'primary', eventId: 'mirvoabcdef' });
      expect(r).toEqual(payload);
      expect(fetchCalls[0].url).toContain('/calendars/primary/events/mirvoabcdef');
    } finally { restore(); }
  });

  it('404 => GoogleApiError(404)', async () => {
    const restore = installFetch(() => ({ ok: false, status: 404, json: async () => ({ error: { errors: [{ reason: 'notFound' }] } }) }));
    try {
      const { getEvent } = await import('@/lib/google-calendar-client');
      await expect(getEvent({ refreshToken: 'rt', calendarId: 'primary', eventId: 'mirvoabcdef' })).rejects.toMatchObject({
        name: 'GoogleApiError', status: 404, reason: 'notFound',
      });
    } finally { restore(); }
  });
});
