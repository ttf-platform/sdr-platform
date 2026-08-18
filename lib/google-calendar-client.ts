/**
 * lib/google-calendar-client.ts
 *
 * LC21 (1) + (2)b — SEUL endroit du lot qui parle a Google.
 *
 * Expose cinq fonctions et rien de plus :
 *   - buildAuthUrl({ state, codeChallenge })
 *   - exchangeCode({ code, codeVerifier })
 *   - verifyIdentity(idToken)
 *   - revoke(token)
 *   - listCalendars({ refreshToken })
 *
 * Aucune fonction d'ecriture d'evenement n'est exposee ni definie dans ce
 * module.
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
