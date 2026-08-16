/**
 * app/api/calendar/google/callback/route.ts
 *
 * LC21 (1) — GET /api/calendar/google/callback
 *
 * Destination unique, succes comme echec :
 *   /dashboard/settings/calendar?status=<motif>
 *
 * Motifs :
 *   refus_google       — parametre ?error present dans la requete
 *   etat_invalide      — cookie absent, signature invalide, exp depasse,
 *                        state divergent, workspace_id vide ou different
 *                        de la session
 *   identite_invalide  — id_token absent ou verifyIdToken echoue
 *   jeton_absent       — refresh_token absent de la reponse token
 *   compte_different   — RPC upsert retourne 0 (google_sub deja pris par un
 *                        autre compte pour ce workspace — cf. WHERE de la RPC)
 *   connecte           — chemin nominal
 *
 * Le cookie est efface dans TOUS les cas. Aucun autre appel Google. Jamais
 * de revocation. Aucun jeton en clair ni chiffre dans la reponse.
 */

import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { encrypt } from '@/lib/crypto';
import { exchangeCode, verifyIdentity } from '@/lib/google-calendar-client';

import { guardOwnerSession } from '../_guard';
import {
  CALENDAR_STATE_COOKIE_NAME,
  buildClearCookieHeader,
  verifyState,
} from '../_state';

export const runtime = 'nodejs';

const DESTINATION = '/dashboard/settings/calendar';

function redirect(request: Request, reason: string, extraHeaders: Record<string, string> = {}): NextResponse {
  const url = new URL(DESTINATION, request.url);
  url.searchParams.set('status', reason);
  const headers = new Headers();
  headers.set('Location', url.toString());
  headers.set('Set-Cookie', buildClearCookieHeader(request));
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  return new NextResponse(null, { status: 302, headers });
}

function readStateCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CALENDAR_STATE_COOKIE_NAME) return rest.join('=');
  }
  return null;
}

export async function GET(request: Request) {
  const guard = await guardOwnerSession();
  if (guard.blocked) {
    // Session absente ou espace non-proprietaire : on ne redirige pas vers
    // le panneau pour ne pas divulguer l'existence de l'espace. On rend
    // l'erreur JSON telle que la garde l'a formee, cookie efface.
    guard.response.headers.set('Set-Cookie', buildClearCookieHeader(request));
    return guard.response;
  }

  const url = new URL(request.url);

  if (url.searchParams.get('error')) {
    return redirect(request, 'refus_google');
  }

  const cookieValue = readStateCookie(request);
  if (!cookieValue) return redirect(request, 'etat_invalide');

  const nowSeconds = Math.floor(Date.now() / 1000);
  let verified;
  try {
    verified = verifyState(cookieValue, nowSeconds);
  } catch {
    return redirect(request, 'etat_invalide');
  }
  if (!verified.ok) return redirect(request, 'etat_invalide');

  const stateParam = url.searchParams.get('state');
  if (!stateParam || stateParam !== verified.payload.state) {
    return redirect(request, 'etat_invalide');
  }
  if (!verified.payload.workspace_id || verified.payload.workspace_id !== guard.workspaceId) {
    return redirect(request, 'etat_invalide');
  }

  const code = url.searchParams.get('code');
  if (!code) return redirect(request, 'etat_invalide');

  let tokens;
  try {
    tokens = await exchangeCode({ code, codeVerifier: verified.payload.code_verifier });
  } catch {
    return redirect(request, 'identite_invalide');
  }

  if (!tokens.idToken) return redirect(request, 'identite_invalide');

  let identity;
  try {
    identity = await verifyIdentity(tokens.idToken);
  } catch {
    return redirect(request, 'identite_invalide');
  }

  if (!tokens.refreshToken) return redirect(request, 'jeton_absent');

  let cipheredRefresh: string;
  try {
    cipheredRefresh = encrypt(tokens.refreshToken);
  } catch {
    return redirect(request, 'jeton_absent');
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('calendar_connection_upsert', {
    p_workspace_id:   guard.workspaceId,
    p_google_sub:     identity.sub,
    p_account_email:  identity.email,
    p_refresh_token:  cipheredRefresh,
    p_granted_scopes: tokens.scope,
  });

  if (error) return redirect(request, 'compte_different');
  const rowCount = typeof data === 'number' ? data : Number(data ?? 0);
  if (!rowCount || rowCount <= 0) return redirect(request, 'compte_different');

  return redirect(request, 'connecte');
}
