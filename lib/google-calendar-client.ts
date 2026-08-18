/**
 * lib/google-calendar-client.ts
 *
 * LC21 (1) + (2)b + (2)c — SEUL endroit du lot qui parle a Google.
 *
 * Expose six fonctions et rien de plus :
 *   - buildAuthUrl({ state, codeChallenge })
 *   - exchangeCode({ code, codeVerifier })
 *   - verifyIdentity(idToken)
 *   - revoke(token)
 *   - listCalendars({ refreshToken })
 *   - listEventsWindow({ refreshToken, calendarId, timeMin, timeMax })
 *
 * Aucune fonction d'ecriture d'evenement n'est exposee ni definie dans ce
 * module. Aucun events.watch, aucun stop de canal, aucun webhook.
 *
 * PORTEE DU SCOPE calendar.events (ecriture) : le scope est demande PAR
 * ANTICIPATION pour le lot (4) — creation, mise a jour et suppression
 * d'evenements par Mirvo. AUCUNE ligne du lot (2) ne l'utilise en ecriture.
 * Ni ce module, ni les routes du lot (2), ne creent, modifient ni suppriment
 * d'evenement Google.
 *
 * Les quatre scopes ci-dessous sont l'ordre canonique demande. verifyIdToken
 * utilise l'audience GOOGLE_CALENDAR_CLIENT_ID (bibliotheque officielle).
 *
 * GOOGLE_CALENDAR_REDIRECT_URI est LU a chaque appel : aucun repli code en
 * dur. Son absence fait lever avant toute construction d'URL.
 */

import { OAuth2Client } from 'google-auth-library';

export const GOOGLE_CALENDAR_SCOPES: readonly string[] = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[google-calendar-client] ${name} is not set`);
  }
  return value;
}

function makeClient(): OAuth2Client {
  const clientId     = requireEnv('GOOGLE_CALENDAR_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CALENDAR_CLIENT_SECRET');
  const redirectUri  = requireEnv('GOOGLE_CALENDAR_REDIRECT_URI');
  return new OAuth2Client({ clientId, clientSecret, redirectUri });
}

export type BuildAuthUrlOptions = {
  state:         string;
  codeChallenge: string;
};

export function buildAuthUrl(options: BuildAuthUrlOptions): string {
  const client = makeClient();
  return client.generateAuthUrl({
    access_type:            'offline',
    prompt:                 'consent',
    include_granted_scopes: false,
    scope:                  GOOGLE_CALENDAR_SCOPES as unknown as string[],
    state:                  options.state,
    code_challenge_method:  'S256' as never,
    code_challenge:         options.codeChallenge,
    redirect_uri:           requireEnv('GOOGLE_CALENDAR_REDIRECT_URI'),
  });
}

export type ExchangeCodeOptions = {
  code:         string;
  codeVerifier: string;
};

export type ExchangeCodeResult = {
  refreshToken: string | null;
  idToken:      string | null;
  scope:        string;
};

export async function exchangeCode(options: ExchangeCodeOptions): Promise<ExchangeCodeResult> {
  const client = makeClient();
  const { tokens } = await client.getToken({
    code:          options.code,
    codeVerifier:  options.codeVerifier,
    redirect_uri:  requireEnv('GOOGLE_CALENDAR_REDIRECT_URI'),
  });
  return {
    refreshToken: tokens.refresh_token ?? null,
    idToken:      tokens.id_token ?? null,
    scope:        typeof tokens.scope === 'string' ? tokens.scope : '',
  };
}

export type VerifyIdentityResult = {
  sub:   string;
  email: string | null;
};

export async function verifyIdentity(idToken: string): Promise<VerifyIdentityResult> {
  const client = makeClient();
  const ticket = await client.verifyIdToken({
    idToken,
    audience: requireEnv('GOOGLE_CALENDAR_CLIENT_ID'),
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) {
    throw new Error('[google-calendar-client] id_token payload without sub');
  }
  return {
    sub:   payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
  };
}

export async function revoke(token: string): Promise<{ ok: boolean }> {
  try {
    const client = makeClient();
    await client.revokeToken(token);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export type CalendarEntry = {
  id:         string;
  name:       string;
  accessRole: string | null;
  primary:    boolean;
};

export type ListCalendarsOptions = {
  refreshToken: string;
};

export async function listCalendars(options: ListCalendarsOptions): Promise<CalendarEntry[]> {
  const client = makeClient();
  client.setCredentials({ refresh_token: options.refreshToken });

  const results: CalendarEntry[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
    url.searchParams.set('maxResults', '250');
    url.searchParams.set('showDeleted', 'false');
    url.searchParams.set('showHidden', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const { token } = await client.getAccessToken();
    if (!token) throw new Error('[google-calendar-client] no access token');

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`[google-calendar-client] calendarList.list ${res.status}`);
    }
    const data = await res.json() as {
      items?: Array<{
        id?:              string;
        summary?:         string;
        summaryOverride?: string;
        accessRole?:      string;
        primary?:         boolean;
      }>;
      nextPageToken?: string;
    };

    if (Array.isArray(data.items)) {
      for (const item of data.items) {
        if (!item.id) continue;
        const displayName = typeof item.summaryOverride === 'string' && item.summaryOverride.length > 0
          ? item.summaryOverride
          : (typeof item.summary === 'string' && item.summary.length > 0 ? item.summary : item.id);
        results.push({
          id:         item.id,
          name:       displayName,
          accessRole: typeof item.accessRole === 'string' ? item.accessRole : null,
          primary:    item.primary === true,
        });
      }
    }

    pageToken = typeof data.nextPageToken === 'string' && data.nextPageToken.length > 0
      ? data.nextPageToken
      : undefined;
  } while (pageToken);

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// LC21 (2)c — listEventsWindow
//
// Miroir des INTERVALLES occupes sur une fenetre bornee [timeMin, timeMax].
// singleEvents=true : chaque occurrence porte son propre id (pas de recurrences
// non expandees). showDeleted=false : les evenements 'cancelled' sont ignores
// cote requete, et la normalisation les rejette de toute facon.
//
// CHAMPS RETOURNES POUR CHAQUE EVENEMENT : id, startsAt, endsAt, transparency.
// RIEN D'AUTRE.
// ─────────────────────────────────────────────────────────────────────────────

export type CalendarEvent = {
  id:           string;
  startsAt:     string; // ISO
  endsAt:       string; // ISO
  transparency: 'opaque' | 'transparent';
};

export type ListEventsWindowOptions = {
  refreshToken: string;
  calendarId:   string;
  timeMin:      string; // ISO
  timeMax:      string; // ISO
};

export type ListEventsWindowIgnored = {
  // Comptes ventiles des evenements ecartes. Uniquement des NOMBRES : aucun
  // identifiant, aucun contenu, aucun journal d'evenement ne remonte ici.
  cancelled:      number; // status === 'cancelled'
  invalid_bounds: number; // starts et ends lisibles, mais ends <= starts
  unreadable:     number; // impossible de deriver starts et ends
};

export type ListEventsWindowResult = {
  events:            CalendarEvent[];
  nextSyncToken:     string | null;
  calendarTimeZone:  string | null;
  ignored:           ListEventsWindowIgnored;
};

function normalizeTransparency(v: unknown): 'opaque' | 'transparent' {
  if (v === 'transparent') return 'transparent';
  return 'opaque';
}

function allDayWindow(startDate: string, endDate: string, tz: string): { starts: string; ends: string } | null {
  // Google : start.date et end.date sont YYYY-MM-DD ; end.date est EXCLUSIVE.
  // On interprete les bornes a minuit dans le fuseau rendu par la reponse.
  // Aucun ajout de jour cote code ; end.date est utilisee telle quelle.
  const startTargetMs = Date.parse(`${startDate}T00:00:00Z`);
  const endTargetMs   = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(startTargetMs) || Number.isNaN(endTargetMs)) return null;

  if (tz === 'UTC') {
    return {
      starts: new Date(startTargetMs).toISOString(),
      ends:   new Date(endTargetMs).toISOString(),
    };
  }

  // Trouve l'instant UTC qui, lu dans le fuseau tz, donne exactement
  // "YYYY-MM-DDT00:00:00". Convergence en 3 iterations : chaque passage
  // corrige l'ecart entre le mur observe dans tz et le mur cible.
  function wallInTzToUtcIso(wallMs: number): string | null {
    let guess = wallMs;
    for (let i = 0; i < 4; i++) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(new Date(guess));
      const map: Record<string, string> = {};
      for (const p of parts) map[p.type] = p.value;
      const observedWall = Date.parse(
        `${map.year}-${map.month}-${map.day}T${map.hour === '24' ? '00' : map.hour}:${map.minute}:${map.second}Z`,
      );
      const delta = observedWall - wallMs;
      if (delta === 0) return new Date(guess).toISOString();
      guess = guess - delta;
    }
    return new Date(guess).toISOString();
  }

  const starts = wallInTzToUtcIso(startTargetMs);
  const ends   = wallInTzToUtcIso(endTargetMs);
  if (!starts || !ends) return null;
  return { starts, ends };
}

export async function listEventsWindow(options: ListEventsWindowOptions): Promise<ListEventsWindowResult> {
  const client = makeClient();
  client.setCredentials({ refresh_token: options.refreshToken });

  const events: CalendarEvent[] = [];
  let pageToken:      string | undefined;
  let nextSyncToken:  string | null = null;
  let calendarTimeZone: string | null = null;

  const ignored: ListEventsWindowIgnored = { cancelled: 0, invalid_bounds: 0, unreadable: 0 };

  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(options.calendarId)}/events`);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('showDeleted',  'false');
    url.searchParams.set('maxResults',   '2500');
    url.searchParams.set('timeMin',      options.timeMin);
    url.searchParams.set('timeMax',      options.timeMax);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const { token } = await client.getAccessToken();
    if (!token) throw new Error('[google-calendar-client] no access token');

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`[google-calendar-client] events.list ${res.status}`);
    }
    const data = await res.json() as {
      timeZone?:      string;
      items?: Array<{
        id?:            string;
        status?:        string;
        transparency?:  string;
        start?:         { dateTime?: string; date?: string };
        end?:           { dateTime?: string; date?: string };
      }>;
      nextPageToken?: string;
      nextSyncToken?: string;
    };

    if (typeof data.timeZone === 'string' && data.timeZone.length > 0) {
      calendarTimeZone = data.timeZone;
    }

    if (Array.isArray(data.items)) {
      for (const item of data.items) {
        if (!item.id) { ignored.unreadable += 1; continue; }
        if (item.status === 'cancelled') { ignored.cancelled += 1; continue; }

        let startsAtIso: string | null = null;
        let endsAtIso:   string | null = null;

        if (item.start?.dateTime && item.end?.dateTime) {
          startsAtIso = new Date(item.start.dateTime).toISOString();
          endsAtIso   = new Date(item.end.dateTime).toISOString();
        } else if (item.start?.date && item.end?.date) {
          const tz = calendarTimeZone ?? 'UTC';
          const win = allDayWindow(item.start.date, item.end.date, tz);
          if (win) {
            startsAtIso = win.starts;
            endsAtIso   = win.ends;
          }
        }

        if (!startsAtIso || !endsAtIso) { ignored.unreadable += 1; continue; }
        if (Date.parse(endsAtIso) <= Date.parse(startsAtIso)) { ignored.invalid_bounds += 1; continue; }

        events.push({
          id:           item.id,
          startsAt:     startsAtIso,
          endsAt:       endsAtIso,
          transparency: normalizeTransparency(item.transparency),
        });
      }
    }

    pageToken = typeof data.nextPageToken === 'string' && data.nextPageToken.length > 0
      ? data.nextPageToken
      : undefined;
    if (!pageToken && typeof data.nextSyncToken === 'string' && data.nextSyncToken.length > 0) {
      nextSyncToken = data.nextSyncToken;
    }
  } while (pageToken);

  return { events, nextSyncToken, calendarTimeZone, ignored };
}
