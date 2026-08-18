/**
 * app/api/calendar/google/sync/route.ts
 *
 * LC21 (2)c — POST : synchronisation complete d'un lot de sources.
 *
 * Auth : CRON_SECRET en Bearer, comparaison par timingSafeEqual (patron
 * strict de app/api/cron/expire-pending-bookings/route.ts). Secret non
 * configure -> 500. Secret faux ou absent -> 401. Aucune session utilisateur
 * n'a acces a cette route.
 *
 * Borne : ne traite QUE CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID.
 *
 * Cette route N'EST PAS inscrite dans vercel.json. C'est voulu — la
 * planification appartient au lot (2)e.
 */

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import { runFullSyncForSource, recomputeMirrorReady } from '@/lib/calendar-sync';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };
const BATCH_MAX = 10;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Misconfigured: CRON_SECRET not set' }, { status: 500, headers: NO_STORE });
  }
  const authHeader = req.headers.get('authorization') ?? '';
  const expected   = `Bearer ${secret}`;
  const provided   = Buffer.from(authHeader);
  const expBuf     = Buffer.from(expected);
  const valid      = provided.length === expBuf.length && timingSafeEqual(provided, expBuf);
  if (!valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }

  const allowedWorkspace = process.env.CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID;
  if (!allowedWorkspace || allowedWorkspace.length === 0) {
    return NextResponse.json({ reason: 'borne_espace' }, { status: 403, headers: NO_STORE });
  }

  const admin = createAdminClient();

  const { data: pendingRows, error: pendingErr } = await admin
    .from('calendar_sources')
    .select('google_calendar_id, sync_requested_at')
    .eq('workspace_id', allowedWorkspace)
    .eq('sync_pending', true)
    .eq('is_conflict',  true)
    .order('sync_requested_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_MAX);

  if (pendingErr) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: NO_STORE });
  }

  const targets = (pendingRows ?? []) as Array<{ google_calendar_id: string; sync_requested_at: string | null }>;

  let succeeded    = 0;
  let failed       = 0;
  let ignoredLease = 0;
  let lostLease    = 0;

  // Agrege des ignores REELS remontes par listEventsWindow, ventiles par
  // motif. Uniquement des NOMBRES : aucun identifiant, aucun contenu.
  const ignoredEvents = { cancelled: 0, invalid_bounds: 0, unreadable: 0 };

  for (const row of targets) {
    const outcome = await runFullSyncForSource({
      workspaceId:      allowedWorkspace,
      googleCalendarId: row.google_calendar_id,
      admin,
    });
    if (outcome.ok) {
      succeeded += 1;
      ignoredEvents.cancelled      += outcome.ignored.cancelled;
      ignoredEvents.invalid_bounds += outcome.ignored.invalid_bounds;
      ignoredEvents.unreadable     += outcome.ignored.unreadable;
    } else if (outcome.reason === 'bail_occupe') {
      ignoredLease += 1;
    } else if (outcome.reason === 'bail_perdu') {
      lostLease += 1;
    } else {
      failed += 1;
    }
  }

  await recomputeMirrorReady({ workspaceId: allowedWorkspace, admin });

  return NextResponse.json({
    treated:        targets.length,
    succeeded,
    failed,
    ignored_lease:  ignoredLease,
    lost_lease:     lostLease,
    ignored_events: ignoredEvents,
  }, { headers: NO_STORE });
}
