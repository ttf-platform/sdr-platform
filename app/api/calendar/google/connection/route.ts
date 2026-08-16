/**
 * app/api/calendar/google/connection/route.ts
 *
 * LC21 (1) —
 *   GET    /api/calendar/google/connection : etat + metadonnees, jamais de
 *          jeton, Cache-Control: no-store.
 *   DELETE /api/calendar/google/connection : suppression, quatre branches.
 *
 * Etats renvoyes (trois valeurs strictement) :
 *   non_connecte
 *   connecte
 *   permissions_a_completer
 *
 * Le calcul 'permissions_a_completer' compare granted_scopes decoupe sur
 * l'espace aux quatre URI CANONIQUES ci-dessous — Google reecrit 'email' en
 * 'https://www.googleapis.com/auth/userinfo.email' lors de l'echange.
 */

import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { revoke } from '@/lib/google-calendar-client';

import { guardOwnerSession } from '../_guard';

export const runtime = 'nodejs';

const CANONICAL_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
] as const;

function computeStatus(grantedScopesRaw: string | null): 'non_connecte' | 'connecte' | 'permissions_a_completer' {
  if (grantedScopesRaw === null) return 'non_connecte';
  const parts = new Set(grantedScopesRaw.split(/\s+/).filter(Boolean));
  for (const s of CANONICAL_SCOPES) {
    if (!parts.has(s)) return 'permissions_a_completer';
  }
  return 'connecte';
}

export async function GET() {
  const guard = await guardOwnerSession();
  if (guard.blocked) return guard.response;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('calendar_connections')
    .select('account_email, connected_at, updated_at, granted_scopes')
    .eq('workspace_id', guard.workspaceId)
    .maybeSingle();

  const headers = { 'Cache-Control': 'no-store' };

  if (error) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers });
  }

  if (!data) {
    return NextResponse.json({
      status:        'non_connecte',
      account_email: '—',
      connected_at:  null,
      updated_at:    null,
    }, { headers });
  }

  return NextResponse.json({
    status:        computeStatus(data.granted_scopes ?? null),
    account_email: data.account_email ?? '—',
    connected_at:  data.connected_at,
    updated_at:    data.updated_at,
  }, { headers });
}

export async function DELETE() {
  const guard = await guardOwnerSession();
  if (guard.blocked) return guard.response;

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from('calendar_connections')
    .select('refresh_token_encrypted')
    .eq('workspace_id', guard.workspaceId)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  // Branche (a) : aucune ligne
  if (!row) {
    return NextResponse.json({ reason: 'aucun_raccordement' }, { status: 404 });
  }

  let refreshToken: string | null = null;
  let decryptThrew = false;
  try {
    refreshToken = decrypt(row.refresh_token_encrypted);
  } catch {
    decryptThrew = true;
  }

  let revokeOk = false;
  if (!decryptThrew && refreshToken) {
    try {
      const r = await revoke(refreshToken);
      revokeOk = r.ok;
    } catch {
      revokeOk = false;
    }
  }

  // La ligne est supprimee dans (b), (c) et (d). Une seule ecriture, apres
  // la tentative de revocation.
  const { error: delErr } = await admin
    .from('calendar_connections')
    .delete()
    .eq('workspace_id', guard.workspaceId);
  if (delErr) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  if (decryptThrew) {
    return NextResponse.json({ reason: 'retire_local_seulement' });
  }
  if (revokeOk) {
    return NextResponse.json({ reason: 'retire' });
  }
  return NextResponse.json({ reason: 'retire_local_seulement' });
}
