/**
 * app/api/calendar/google/sources/route.ts
 *
 * LC21 (2)b + (2)c — liste des calendriers Google d'un espace, et selection
 * conflit / ecriture par le proprietaire.
 *
 *   GET  /api/calendar/google/sources           : lecture locale.
 *   GET  /api/calendar/google/sources?refresh=1 : rafraichit depuis Google
 *                                                 AVANT lecture. Soumis a la
 *                                                 borne d'espace et a un
 *                                                 limiteur echouant ferme.
 *   PUT  /api/calendar/google/sources           : pose is_conflict et
 *                                                 is_write_target pour cet
 *                                                 espace, arme la
 *                                                 synchronisation, et remet
 *                                                 mirror_ready = false.
 *
 * (2)c : le PUT declenche la synchronisation en armant sync_pending sur les
 * sources devenues is_conflict, et le desarme sur celles qui l'ont perdue.
 * La bascule mirror_ready vers true reste l'apanage du moteur ; ici on ne
 * fait que retomber a false quand la selection change.
 */

import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { rateLimitByWorkspace } from '@/lib/rate-limit';
import { listCalendars, type CalendarEntry } from '@/lib/google-calendar-client';

import { guardOwnerSession } from '../_guard';

export const runtime = 'nodejs';

type SourceRow = {
  google_calendar_id: string;
  display_name:       string;
  access_role:        string | null;
  is_conflict:        boolean;
  is_write_target:    boolean;
  still_present:      boolean;
};

const NO_STORE = { 'Cache-Control': 'no-store' };

function internalError(): NextResponse {
  return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: NO_STORE });
}

async function ensureSyncState(admin: ReturnType<typeof createAdminClient>, workspaceId: string): Promise<{ mirror_ready: boolean } | null> {
  const { data, error } = await admin
    .from('calendar_sync_state')
    .select('mirror_ready')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) return null;
  if (data) return { mirror_ready: data.mirror_ready === true };

  const { error: insertErr } = await admin
    .from('calendar_sync_state')
    .insert({ workspace_id: workspaceId, mirror_ready: false });
  if (insertErr) return null;
  return { mirror_ready: false };
}

async function readSources(admin: ReturnType<typeof createAdminClient>, workspaceId: string): Promise<SourceRow[] | null> {
  const { data, error } = await admin
    .from('calendar_sources')
    .select('google_calendar_id, display_name, access_role, is_conflict, is_write_target, still_present')
    .eq('workspace_id', workspaceId)
    .order('display_name', { ascending: true });
  if (error) return null;
  return (data ?? []) as SourceRow[];
}

async function refreshFromGoogle(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
): Promise<{ ok: true; primaryIds: Set<string> } | { ok: false; response: NextResponse }> {
  const { data: connRow, error: connErr } = await admin
    .from('calendar_connections')
    .select('refresh_token_encrypted')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (connErr) return { ok: false, response: internalError() };
  if (!connRow) return { ok: false, response: NextResponse.json({ reason: 'aucun_raccordement' }, { status: 404, headers: NO_STORE }) };

  let refreshToken: string;
  try {
    refreshToken = decrypt(connRow.refresh_token_encrypted);
  } catch {
    return { ok: false, response: internalError() };
  }

  let entries: CalendarEntry[];
  try {
    entries = await listCalendars({ refreshToken });
  } catch {
    return { ok: false, response: NextResponse.json({ reason: 'echec_rafraichissement' }, { status: 502, headers: NO_STORE }) };
  }

  const nowIso = new Date().toISOString();
  const rowsForUpsert = entries.map(e => ({
    workspace_id:       workspaceId,
    google_calendar_id: e.id,
    display_name:       e.name,
    access_role:        e.accessRole,
    still_present:      true,
    updated_at:         nowIso,
  }));

  if (rowsForUpsert.length > 0) {
    const { error: upsertErr } = await admin
      .from('calendar_sources')
      .upsert(rowsForUpsert, { onConflict: 'workspace_id,google_calendar_id' });
    if (upsertErr) return { ok: false, response: internalError() };
  }

  const { data: existing, error: existingErr } = await admin
    .from('calendar_sources')
    .select('google_calendar_id')
    .eq('workspace_id', workspaceId);
  if (existingErr) return { ok: false, response: internalError() };

  const seen = new Set(entries.map(e => e.id));
  const disappeared = ((existing ?? []) as Array<{ google_calendar_id: string }>)
    .map(r => r.google_calendar_id)
    .filter(id => !seen.has(id));

  if (disappeared.length > 0) {
    const { error: disappearErr } = await admin
      .from('calendar_sources')
      .update({
        still_present:   false,
        is_conflict:     false,
        is_write_target: false,
      })
      .eq('workspace_id', workspaceId)
      .in('google_calendar_id', disappeared);
    if (disappearErr) return { ok: false, response: internalError() };
  }

  const primaryIds = new Set<string>();
  for (const e of entries) {
    if (e.primary) primaryIds.add(e.id);
  }
  return { ok: true, primaryIds };
}

export async function GET(request: Request) {
  const guard = await guardOwnerSession();
  if (guard.blocked) return guard.response;

  const admin = createAdminClient();

  // Le booleen `primary` de la reponse est UNIQUEMENT connu si on vient de
  // rafraichir : il est rendu par Google (calendarList.primary). Aucune
  // persistance, aucune deduction a partir d'un identifiant. Sans refresh,
  // primary est faux partout — le pre-cochage cote formulaire est alors
  // volontairement inactif.
  let primaryIds: Set<string> = new Set();

  const url = new URL(request.url);
  if (url.searchParams.get('refresh') === '1') {
    const allowed = process.env.CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID;
    if (!allowed || allowed.length === 0 || allowed !== guard.workspaceId) {
      return NextResponse.json({ reason: 'borne_espace' }, { status: 403, headers: NO_STORE });
    }
    try {
      const rl = await rateLimitByWorkspace(guard.workspaceId, {
        limit:  30,
        window: '10 m',
        prefix: 'calendar-sources-refresh',
      });
      if (!rl.allowed) return rl.response;
    } catch {
      return internalError();
    }

    const outcome = await refreshFromGoogle(admin, guard.workspaceId);
    if (!outcome.ok) return outcome.response;
    primaryIds = outcome.primaryIds;
  }

  const syncState = await ensureSyncState(admin, guard.workspaceId);
  if (!syncState) return internalError();

  const rows = await readSources(admin, guard.workspaceId);
  if (rows === null) return internalError();

  return NextResponse.json({
    mirror_ready: syncState.mirror_ready,
    sources: rows.map(r => ({
      id:              r.google_calendar_id,
      display_name:    r.display_name,
      access_role:     r.access_role,
      is_conflict:     r.is_conflict === true,
      is_write_target: r.is_write_target === true,
      still_present:   r.still_present === true,
      primary:         primaryIds.has(r.google_calendar_id),
    })),
  }, { headers: NO_STORE });
}

type PutBody = {
  conflict_ids:     unknown;
  write_target_id:  unknown;
};

function parsePutBody(raw: unknown): { ok: true; conflictIds: string[]; writeTargetId: string | null } | { ok: false; response: NextResponse } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, response: NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE }) };
  }
  const body = raw as PutBody;

  if (!Array.isArray(body.conflict_ids)) {
    return { ok: false, response: NextResponse.json({ error: 'Invalid payload' }, { status: 400, headers: NO_STORE }) };
  }
  const conflictIds: string[] = [];
  for (const v of body.conflict_ids) {
    if (typeof v !== 'string' || v.length === 0) {
      return { ok: false, response: NextResponse.json({ error: 'Invalid payload' }, { status: 400, headers: NO_STORE }) };
    }
    conflictIds.push(v);
  }
  if (new Set(conflictIds).size !== conflictIds.length) {
    return { ok: false, response: NextResponse.json({ error: 'Invalid payload' }, { status: 400, headers: NO_STORE }) };
  }

  let writeTargetId: string | null;
  if (body.write_target_id === null || body.write_target_id === undefined) {
    writeTargetId = null;
  } else if (typeof body.write_target_id === 'string' && body.write_target_id.length > 0) {
    writeTargetId = body.write_target_id;
  } else {
    return { ok: false, response: NextResponse.json({ error: 'Invalid payload' }, { status: 400, headers: NO_STORE }) };
  }

  return { ok: true, conflictIds, writeTargetId };
}

export async function PUT(request: Request) {
  const guard = await guardOwnerSession();
  if (guard.blocked) return guard.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
  }

  const parsed = parsePutBody(raw);
  if (!parsed.ok) return parsed.response;

  const admin = createAdminClient();

  const { data: rowsData, error: rowsErr } = await admin
    .from('calendar_sources')
    .select('google_calendar_id, still_present, access_role, is_conflict')
    .eq('workspace_id', guard.workspaceId);
  if (rowsErr) return internalError();

  const knownById = new Map<string, { still_present: boolean; access_role: string | null; was_conflict: boolean }>();
  for (const r of (rowsData ?? []) as Array<{ google_calendar_id: string; still_present: boolean; access_role: string | null; is_conflict: boolean }>) {
    knownById.set(r.google_calendar_id, {
      still_present: r.still_present === true,
      access_role:   r.access_role ?? null,
      was_conflict:  r.is_conflict === true,
    });
  }

  const requestedIds: string[] = [...parsed.conflictIds];
  if (parsed.writeTargetId) requestedIds.push(parsed.writeTargetId);

  // 1. calendrier_inconnu
  for (const id of requestedIds) {
    if (!knownById.has(id)) {
      return NextResponse.json({ error: 'calendrier_inconnu', google_calendar_id: id }, { status: 400, headers: NO_STORE });
    }
  }
  // 2. calendrier_absent
  for (const id of requestedIds) {
    const meta = knownById.get(id)!;
    if (!meta.still_present) {
      return NextResponse.json({ error: 'calendrier_absent', google_calendar_id: id }, { status: 400, headers: NO_STORE });
    }
  }
  // 3. calendrier_ecriture_requis
  if (parsed.conflictIds.length > 0 && !parsed.writeTargetId) {
    return NextResponse.json({ error: 'calendrier_ecriture_requis' }, { status: 400, headers: NO_STORE });
  }
  // 4. role_insuffisant
  if (parsed.writeTargetId) {
    const meta = knownById.get(parsed.writeTargetId)!;
    const role = (meta.access_role ?? '').toLowerCase();
    if (role !== 'owner' && role !== 'writer') {
      return NextResponse.json({ error: 'role_insuffisant', google_calendar_id: parsed.writeTargetId }, { status: 400, headers: NO_STORE });
    }
  }

  // 5. Ecriture — Postgres n'offre pas de multi-statement transaction via
  // PostgREST sans nouvelle fonction. On applique l'ordre garanti par 094 :
  // d'abord clear TOTAL (l'index unique partiel is_write_target ne peut plus
  // etre viole), puis pose des drapeaux demandes. Aucune etape intermediaire
  // ne cree un doublon.
  const { error: clearErr } = await admin
    .from('calendar_sources')
    .update({ is_conflict: false, is_write_target: false })
    .eq('workspace_id', guard.workspaceId);
  if (clearErr) return internalError();

  if (parsed.conflictIds.length > 0) {
    const { error: setConflictErr } = await admin
      .from('calendar_sources')
      .update({ is_conflict: true })
      .eq('workspace_id', guard.workspaceId)
      .in('google_calendar_id', parsed.conflictIds);
    if (setConflictErr) return internalError();
  }

  if (parsed.writeTargetId) {
    const { error: setWriteErr } = await admin
      .from('calendar_sources')
      .update({ is_write_target: true })
      .eq('workspace_id', guard.workspaceId)
      .eq('google_calendar_id', parsed.writeTargetId);
    if (setWriteErr) return internalError();
  }

  // (2)c — armement de la synchronisation. Compare l'etat AVANT / APRES la
  // pose des drapeaux pour identifier les transitions.
  const newConflictSet = new Set(parsed.conflictIds);
  const becameConflict: string[] = [];
  const wasConflictOnly: string[] = [];
  for (const [id, meta] of knownById.entries()) {
    const isNowConflict = newConflictSet.has(id);
    if (isNowConflict && !meta.was_conflict) becameConflict.push(id);
    if (!isNowConflict && meta.was_conflict) wasConflictOnly.push(id);
  }

  const nowIso = new Date().toISOString();
  if (becameConflict.length > 0) {
    const { error: armErr } = await admin
      .from('calendar_sources')
      .update({
        sync_pending:      true,
        sync_requested_at: nowIso,
        last_error:        null,
      })
      .eq('workspace_id', guard.workspaceId)
      .in('google_calendar_id', becameConflict);
    if (armErr) return internalError();
  }
  if (wasConflictOnly.length > 0) {
    const { error: disarmErr } = await admin
      .from('calendar_sources')
      .update({
        sync_pending:      false,
        sync_requested_at: null,
        sync_token:        null,
      })
      .eq('workspace_id', guard.workspaceId)
      .in('google_calendar_id', wasConflictOnly);
    if (disarmErr) return internalError();
  }

  // mirror_ready = false : le perimetre a change (ou vient d'etre confirme),
  // le miroir n'est plus repute complet tant que le moteur n'a pas rendu la
  // main. Ne touche la ligne que si un flip est necessaire — inutile
  // d'ecrire pour maintenir false a false.
  const stateRead = await admin
    .from('calendar_sync_state')
    .select('mirror_ready')
    .eq('workspace_id', guard.workspaceId)
    .maybeSingle();
  if (stateRead.error) return internalError();

  if (!stateRead.data) {
    const { error: insErr } = await admin
      .from('calendar_sync_state')
      .insert({ workspace_id: guard.workspaceId, mirror_ready: false });
    if (insErr) return internalError();
  } else if (stateRead.data.mirror_ready === true) {
    const { error: updErr } = await admin
      .from('calendar_sync_state')
      .update({ mirror_ready: false })
      .eq('workspace_id', guard.workspaceId);
    if (updErr) return internalError();
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
