/**
 * lib/google-calendar-client.ts
 *
 * LC21 (1) — SEUL endroit du lot qui parle a Google.
 *
 * Expose quatre fonctions et rien de plus :
 *   - buildAuthUrl({ state, codeChallenge })
 *   - exchangeCode({ code, codeVerifier })
 *   - verifyIdentity(idToken)
 *   - revoke(token)
 *
 * Aucun freebusy, aucune liste ni selection de calendriers, aucune creation
 * d'evenement. Aucune expansion de scopes.
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
  'https://www.googleapis.com/auth/calendar.events.freebusy',
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
