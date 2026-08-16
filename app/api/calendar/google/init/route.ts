/**
 * app/api/calendar/google/init/route.ts
 *
 * LC21 (1) — POST /api/calendar/google/init
 *
 * 1. garde commune (session + owner)
 * 2. refus si CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID absente/vide/differente
 *    → 403 { reason: 'borne_espace' }
 * 3. limiteur dedie 'calendar-oauth-init' ECHOUANT FERME :
 *    magasin indisponible ou en erreur → 500, aucune URL, aucun cookie
 * 4. sonde de chiffrement : decrypt(encrypt(temoin)) === temoin, ET un chiffre
 *    dont un octet est modifie doit faire lever decrypt. Sinon → 500.
 * 5. generateCodeVerifierAsync, state cryptographique
 * 6. pose du cookie signe
 * 7. reponse JSON { url }. Le client navigue par window.location.assign.
 */

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';

import { rateLimitByWorkspace } from '@/lib/rate-limit';
import { encrypt, decrypt } from '@/lib/crypto';
import { buildAuthUrl } from '@/lib/google-calendar-client';

import { guardOwnerSession } from '../_guard';
import {
  buildSetCookieHeader,
  CALENDAR_STATE_COOKIE_MAX_AGE,
  signState,
} from '../_state';

export const runtime = 'nodejs';

function fail500(): NextResponse {
  return NextResponse.json({ error: 'Internal error' }, { status: 500 });
}

async function encryptionProbeOk(): Promise<boolean> {
  try {
    const witness = 'lc21-calendar-probe';
    const ciphered = encrypt(witness);
    if (decrypt(ciphered) !== witness) return false;

    // Flip one byte of the ciphertext to force a GCM tag mismatch. decrypt()
    // MUST throw ; if it doesn't, the tag isn't enforced and we refuse to
    // write anything downstream.
    const raw = Buffer.from(ciphered, 'base64');
    if (raw.length < 1) return false;
    const flipped = Buffer.from(raw);
    const idx = flipped.length > 44 ? 44 : flipped.length - 1;
    flipped[idx] = flipped[idx] ^ 0x01;
    const tampered = flipped.toString('base64');
    try {
      decrypt(tampered);
      return false;
    } catch {
      return true;
    }
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const guard = await guardOwnerSession();
  if (guard.blocked) return guard.response;

  const allowed = process.env.CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID;
  if (!allowed || allowed.length === 0 || allowed !== guard.workspaceId) {
    return NextResponse.json({ reason: 'borne_espace' }, { status: 403 });
  }

  // Fail-closed rate limiter. Any throw from the backing store must produce
  // a 500 with no URL, no cookie — never a green light.
  try {
    const rl = await rateLimitByWorkspace(guard.workspaceId, {
      limit:  10,
      window: '10 m',
      prefix: 'calendar-oauth-init',
    });
    if (!rl.allowed) return rl.response;
  } catch {
    return fail500();
  }

  if (!(await encryptionProbeOk())) return fail500();

  let codeVerifier: string;
  let codeChallenge: string;
  try {
    const tmp  = new OAuth2Client();
    const pkce = await tmp.generateCodeVerifierAsync();
    if (!pkce.codeChallenge) return fail500();
    codeVerifier  = pkce.codeVerifier;
    codeChallenge = pkce.codeChallenge;
  } catch {
    return fail500();
  }

  const state = randomBytes(32).toString('base64url');
  const exp   = Math.floor(Date.now() / 1000) + CALENDAR_STATE_COOKIE_MAX_AGE;

  let signedCookie: string;
  let url: string;
  try {
    signedCookie = signState({
      state,
      code_verifier: codeVerifier,
      workspace_id:  guard.workspaceId,
      exp,
    });
    url = buildAuthUrl({ state, codeChallenge });
  } catch {
    return fail500();
  }

  const setCookie = buildSetCookieHeader(request, signedCookie);
  return NextResponse.json({ url }, { status: 200, headers: { 'Set-Cookie': setCookie } });
}
