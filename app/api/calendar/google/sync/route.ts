/**
 * app/api/calendar/google/sync/route.ts
 *
 * LC21 (2)c + (2)FIN — synchronisation complete d'un lot de sources.
 *
 * Auth : CRON_SECRET en Bearer, comparaison par timingSafeEqual (patron
 * strict de app/api/cron/expire-pending-bookings/route.ts). Secret non
 * configure -> 500. Secret faux ou absent -> 401. Aucune session utilisateur
 * n'a acces a cette route.
 *
 * Borne : ne traite QUE CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID.
 *
 * (2)FIN — GET et POST partagent EXACTEMENT le meme corps :
 *   - le planificateur Vercel appelle en GET (les quatorze crons existants
 *     du depot exportent tous GET) ;
 *   - POST reste ouvert pour un appel manuel ou une commande d'operation.
 * Aucune logique dupliquee, aucune seconde garde, aucun comportement
 * different entre les deux verbes.
 */

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  runFullSyncForSource,
  recomputeMirrorReady,
  readMirrorFreshness,
} from '@/lib/calendar-sync';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };
const BATCH_MAX = 10;

async function runSyncRequest(req: Request): Promise<NextResponse> {
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

  // (2)FIN — SELECTION.
  //
  // Eligibilite : is_conflict = true ET still_present = true. Rien d'autre.
  // Ordre :
  //   1. sync_pending = true en premier (booleen : true > false, donc DESC),
  //      trie par sync_requested_at ASC ;
  //   2. puis les autres : last_sync_at IS NULL en premier (NULLS FIRST
  //      IMPOSE EXPLICITEMENT), puis last_sync_at croissant.
  // Plafond : dix par tour ; execution sequentielle.
  //
  // Les trois `.order()` sont chaines : Supabase JS pousse a PostgREST un
  // `order=col1.dir.nulls,col2.dir.nulls,...`. nullsFirst est POSE POUR
  // CHAQUE colonne concernee — jamais laisse au defaut du client ni du
  // moteur, sinon le rangement des NULL de last_sync_at bascule (le defaut
  // Postgres ASC est NULLS LAST, contraire a notre invariant "never_synced
  // en premier").
  const { data: pendingRows, error: pendingErr } = await admin
    .from('calendar_sources')
    .select('google_calendar_id, sync_pending, sync_requested_at, last_sync_at')
    .eq('workspace_id',   allowedWorkspace)
    .eq('is_conflict',    true)
    .eq('still_present',  true)
    .order('sync_pending',      { ascending: false, nullsFirst: false }) // true > false, TRUE first
    .order('sync_requested_at', { ascending: true,  nullsFirst: false }) // NULLS LAST — les non-pending (sync_requested_at null) restent groupees en 2e groupe
    .order('last_sync_at',      { ascending: true,  nullsFirst: true  }) // NULLS FIRST — never_synced avant les autres
    .limit(BATCH_MAX);

  if (pendingErr) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: NO_STORE });
  }

  const targets = (pendingRows ?? []) as Array<{
    google_calendar_id: string;
    sync_pending:       boolean;
    sync_requested_at:  string | null;
    last_sync_at:       string | null;
  }>;

  let succeeded    = 0;
  let failed       = 0;
  let ignoredLease = 0;
  let lostLease    = 0;

  // Agrege des ignores REELS remontes par listEventsWindow, ventiles par
  // motif. Uniquement des NOMBRES : aucun identifiant, aucun contenu.
  const ignoredEvents = { cancelled: 0, invalid_bounds: 0, unreadable: 0 };

  // Garde-fou anti-doublon dans le meme tour : le plafond .limit(10) et la
  // cle primaire garantissent deja l'unicite, mais on protege
  // explicitement contre toute duplication accidentelle.
  const seen = new Set<string>();
  for (const row of targets) {
    if (seen.has(row.google_calendar_id)) continue;
    seen.add(row.google_calendar_id);

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

  // (2)FIN — expose la fraicheur du miroir dans le compte-rendu. Ces
  // valeurs sont des FAITS. La peremption est appliquee par le lot (3), pas
  // ici — mirror_ready sort tel qu'il est en base.
  //
  // LC21 (3)A — readMirrorFreshness rend desormais un resultat DISCRIMINE.
  //
  // CE QUI CHANGE, ET IL NE FAUT PAS ECRIRE QUE RIEN NE CHANGE :
  //
  //   - sur `lecture_sources` : la reponse est IDENTIQUE a l'ancienne. Les
  //     sources n'avaient pas pu etre lues, donc l'ancienne implementation
  //     rendait deja null et 0.
  //
  //   - sur `lecture_etat` : la reponse DIFFERE. L'ancienne implementation
  //     avait deja lu les sources et calcule oldest_last_sync_at et
  //     never_synced ; seule la lecture de mirror_ready etait avalee, et ces
  //     deux faits sortaient quand meme. Avec l'union, ils sont perdus au
  //     profit de null et 0.
  //
  // DIFFERENCE ASSUMEE, et voici son perimetre exact : ce corps de reponse
  // n'a AUCUN consommateur fonctionnel — verifie sur tout le depot, seuls les
  // tests le lisent, et vercel.json ne declare que le chemin ; le
  // planificateur jette le corps. Preserver des faits partiels sur une erreur
  // de lecture aurait exige de complexifier le type pour un lecteur qui
  // n'existe pas.
  //
  // mirror_ready ne sort pas d'ici et n'est pas interprete : la peremption est
  // appliquee par decideMirror, au moment de decider — D38 §9.
  const freshness        = await readMirrorFreshness({ workspaceId: allowedWorkspace, admin });
  const oldestLastSyncAt = freshness.ok ? freshness.facts.oldest_last_sync_at : null;
  const neverSynced      = freshness.ok ? freshness.facts.never_synced        : 0;

  return NextResponse.json({
    treated:             targets.length,
    succeeded,
    failed,
    ignored_lease:       ignoredLease,
    lost_lease:          lostLease,
    ignored_events:      ignoredEvents,
    oldest_last_sync_at: oldestLastSyncAt,
    never_synced:        neverSynced,
  }, { headers: NO_STORE });
}

export async function POST(req: Request) { return runSyncRequest(req); }
export async function GET(req: Request)  { return runSyncRequest(req); }
