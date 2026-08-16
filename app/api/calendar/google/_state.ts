/**
 * app/api/calendar/google/_state.ts
 *
 * LC21 (1) — cookie d'etat OAuth : mirvo_gcal_state.
 *
 * Charge : { state, code_verifier, workspace_id, exp }
 * Format : base64url(JSON) + '.' + base64url(HMAC-SHA256(base64url(JSON), CALENDAR_STATE_SIGNING_KEY))
 *
 * Verification : longueurs comparees d'abord, puis timingSafeEqual sur les
 * signatures. exp verifie cote serveur (secondes epoch).
 *
 * CALENDAR_STATE_SIGNING_KEY absente ou < 32 caracteres → throw. La route
 * appelante doit en tirer un 500 : jamais de cle vide, jamais de signature
 * degradee.
 *
 * Attributs cookie : httpOnly, SameSite=Lax, Path=/api/calendar/google,
 * Max-Age=600. Secure pose seulement si la requete est https.
 *
 * Fichier prefixe '_' pour rester hors du router App-Router.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export const CALENDAR_STATE_COOKIE_NAME = 'mirvo_gcal_state';
export const CALENDAR_STATE_COOKIE_PATH = '/api/calendar/google';
export const CALENDAR_STATE_COOKIE_MAX_AGE = 600;

export type CalendarStatePayload = {
  state:         string;
  code_verifier: string;
  workspace_id:  string;
  exp:           number;
};

function requireSigningKey(): string {
  const key = process.env.CALENDAR_STATE_SIGNING_KEY;
  if (!key || key.length < 32) {
    throw new Error('[calendar-state] CALENDAR_STATE_SIGNING_KEY missing or too short');
  }
  return key;
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signState(payload: CalendarStatePayload): string {
  const key    = requireSigningKey();
  const body   = toBase64Url(Buffer.from(JSON.stringify(payload), 'utf-8'));
  const sig    = toBase64Url(createHmac('sha256', key).update(body).digest());
  return `${body}.${sig}`;
}

export type VerifyStateResult =
  | { ok: true;  payload: CalendarStatePayload }
  | { ok: false; reason: 'shape' | 'signature' | 'json' | 'expired' };

export function verifyState(cookieValue: string, nowSeconds: number): VerifyStateResult {
  const key = requireSigningKey();
  const dot = cookieValue.indexOf('.');
  if (dot <= 0 || dot === cookieValue.length - 1) return { ok: false, reason: 'shape' };

  const body = cookieValue.slice(0, dot);
  const sig  = cookieValue.slice(dot + 1);

  let sigBuf: Buffer;
  try {
    sigBuf = fromBase64Url(sig);
  } catch {
    return { ok: false, reason: 'signature' };
  }
  const expectedBuf = createHmac('sha256', key).update(body).digest();
  if (sigBuf.length !== expectedBuf.length) return { ok: false, reason: 'signature' };
  if (!timingSafeEqual(sigBuf, expectedBuf)) return { ok: false, reason: 'signature' };

  let payload: unknown;
  try {
    payload = JSON.parse(fromBase64Url(body).toString('utf-8'));
  } catch {
    return { ok: false, reason: 'json' };
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as CalendarStatePayload).state !== 'string' ||
    typeof (payload as CalendarStatePayload).code_verifier !== 'string' ||
    typeof (payload as CalendarStatePayload).workspace_id !== 'string' ||
    typeof (payload as CalendarStatePayload).exp !== 'number'
  ) {
    return { ok: false, reason: 'json' };
  }
  const typed = payload as CalendarStatePayload;
  if (typed.exp <= nowSeconds) return { ok: false, reason: 'expired' };
  return { ok: true, payload: typed };
}

function isHttpsRequest(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim().toLowerCase() === 'https';
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function buildSetCookieHeader(request: Request, value: string): string {
  const parts = [
    `${CALENDAR_STATE_COOKIE_NAME}=${value}`,
    `Path=${CALENDAR_STATE_COOKIE_PATH}`,
    `Max-Age=${CALENDAR_STATE_COOKIE_MAX_AGE}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isHttpsRequest(request)) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearCookieHeader(request: Request): string {
  const parts = [
    `${CALENDAR_STATE_COOKIE_NAME}=`,
    `Path=${CALENDAR_STATE_COOKIE_PATH}`,
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isHttpsRequest(request)) parts.push('Secure');
  return parts.join('; ');
}
