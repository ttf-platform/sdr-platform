/**
 * lib/calendar-sync.ts
 *
 * LC21 (2)c — moteur de synchronisation complete d'UN calendrier.
 *
 *   runFullSyncForSource({ workspaceId, googleCalendarId })
 *     Prend un bail, verifie l'eligibilite, dechiffre le refresh_token, lit
 *     Google sur une fenetre bornee, ecrit le nouveau jeu en generation
 *     alternee, bascule active_generation en UNE instruction, purge l'ancien
 *     jeu. Retourne un resultat structure, jamais une exception non rattrapee.
 *
 *   recomputeMirrorReady({ workspaceId })
 *     Recalcule l'etat global du miroir a partir des sources is_conflict.
 *     Ne pose first_full_sync_done_at qu'une seule fois (a la premiere
 *     bascule vers mirror_ready=true).
 *
 * BAIL COMME CAPACITE. Le bail n'est PAS un simple booleen : c'est un jeton
 * — l'echeance exacte posee dans sync_lease_until. LA POSSESSION N'EST
 * JAMAIS EVALUEE EN JAVASCRIPT : chaque ecriture de (2)c est conditionnee
 * `WHERE sync_lease_until = jeton`, comparaison faite PAR LA BASE sur des
 * valeurs timestamptz — donc independante de la representation textuelle
 * de l'instant (`Z`, `+00:00`, tout autre decalage). Si le bail a ete repris
 * entre-temps, l'ecriture affecte zero ligne et on sort en bail_perdu.
 * En complement, avant CHAQUE lot d'insertion, on relit
 * active_generation ; s'il vaut deja la generation cible, une autre
 * execution a bascule sur notre cible et on arrete. Cette double garde rend
 * STRUCTUREL le fait que rien n'est jamais ecrit ni purge sur la generation
 * active.
 *
 * PORTEE : aucune ecriture d'evenement cote Google, aucun watch, aucun
 * webhook, aucune lecture incrementale par syncToken. Le nextSyncToken est
 * stocke tel quel s'il est rendu par Google — sa consommation appartient a
 * (2)d.
 */

import type { createAdminClient } from '@/lib/supabase/admin';
import { createAdminClient as makeAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import {
  listEventsWindow,
  type CalendarEvent,
  type ListEventsWindowIgnored,
} from '@/lib/google-calendar-client';

// Borne technique provisoire du lot (2)c, a reconsiderer au lot (3), ne vaut
// aucune regle produit.
export const MIRROR_WINDOW_PAST_DAYS   = 1;
export const MIRROR_WINDOW_FUTURE_DAYS = 120;

// Seuil provisoire, ajustable apres mesure reelle, ne vaut aucune regle
// produit definitive. La cadence planifiee etant de 15 minutes, ce seuil
// correspond a deux tours manques. Ce module l'expose ; il ne l'applique
// nulle part. La peremption est une LECTURE, appliquee par le lot (3) au
// moment de decider — jamais une transformation de l'etat pose en base.
export const MIRROR_STALE_AFTER_MINUTES = 30;

type Admin = ReturnType<typeof createAdminClient>;

export type SyncIgnored = ListEventsWindowIgnored;

export type RunFullSyncOutcome =
  | { ok: true;  reason: 'sync_ok';           written: number; ignored: SyncIgnored; nextSyncTokenStored: boolean }
  | { ok: false; reason: 'bail_occupe' }
  | { ok: false; reason: 'bail_perdu' }
  | { ok: false; reason: 'source_non_eligible' }
  | { ok: false; reason: 'jeton_indisponible' }
  | { ok: false; reason: 'echec_google' };

export type RunFullSyncInput = {
  workspaceId:      string;
  googleCalendarId: string;
  admin?:           Admin;
  now?:             Date;
};

const LEASE_MINUTES = 5;

function windowIso(now: Date): { timeMin: string; timeMax: string } {
  const past   = new Date(now.getTime() - MIRROR_WINDOW_PAST_DAYS   * 24 * 60 * 60 * 1000);
  const future = new Date(now.getTime() + MIRROR_WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000);
  return { timeMin: past.toISOString(), timeMax: future.toISOString() };
}

function newLeaseToken(now: Date): string {
  return new Date(now.getTime() + LEASE_MINUTES * 60 * 1000).toISOString();
}

// Utilise l'HEURE REELLE au moment de l'appel, pas le `now` d'entree de
// runFullSyncForSource. C'est ce qui permet a l'echeance de bail d'AVANCER
// entre deux prolongations — sans cela, chaque extendLease reposerait la
// meme valeur, le jeton evoluerait mais l'horizon d'expiration resterait
// fige au T0 + LEASE_MINUTES : une synchronisation dont l'ecriture depasse
// LEASE_MINUTES serait fatalement depossedee.
function freshLeaseToken(): string {
  return new Date(Date.now() + LEASE_MINUTES * 60 * 1000).toISOString();
}

// Prise initiale du bail. Rend le JETON pose (ISO exact) ou null si aucun
// bail n'a pu etre pris. Ce jeton est ce qui identifie la possession pour
// TOUTES les ecritures suivantes.
async function tryAcquireLease(admin: Admin, workspaceId: string, googleCalendarId: string, now: Date): Promise<string | null> {
  const token = newLeaseToken(now);

  // (1) bail libre : sync_lease_until IS NULL
  const free = await admin
    .from('calendar_sources')
    .update({ sync_lease_until: token })
    .eq('workspace_id', workspaceId)
    .eq('google_calendar_id', googleCalendarId)
    .is('sync_lease_until', null)
    .select('google_calendar_id');
  if (free.error) return null;
  if (Array.isArray(free.data) && free.data.length > 0) return token;

  // (2) bail expire : sync_lease_until < now
  const expired = await admin
    .from('calendar_sources')
    .update({ sync_lease_until: token })
    .eq('workspace_id', workspaceId)
    .eq('google_calendar_id', googleCalendarId)
    .lt('sync_lease_until', now.toISOString())
    .select('google_calendar_id');
  if (expired.error) return null;
  if (Array.isArray(expired.data) && expired.data.length > 0) return token;

  return null;
}

// Prolongation conditionnee. La ligne n'est mise a jour QUE si sync_lease_until
// vaut encore le jeton courant. Rend le NOUVEAU jeton pose en cas de succes,
// null si le bail nous a ete pris entre-temps.
//
// L'echeance posee est calculee sur l'heure REELLE au moment de l'appel
// (Date.now()), pas sur le `now` d'entree de runFullSyncForSource. C'est
// cette regle qui rend la prolongation EFFECTIVE : sans elle, chaque
// extendLease reposerait la meme valeur et l'expiration resterait scellee
// au T0 initial.
async function extendLease(admin: Admin, workspaceId: string, googleCalendarId: string, currentToken: string): Promise<string | null> {
  const next = freshLeaseToken();
  const res = await admin
    .from('calendar_sources')
    .update({ sync_lease_until: next })
    .eq('workspace_id', workspaceId)
    .eq('google_calendar_id', googleCalendarId)
    .eq('sync_lease_until', currentToken)
    .select('google_calendar_id');
  if (res.error) return null;
  if (!Array.isArray(res.data) || res.data.length === 0) return null;
  return next;
}

async function releaseLease(admin: Admin, workspaceId: string, googleCalendarId: string): Promise<void> {
  // Uniquement utilise en sortie source_non_eligible / jeton_indisponible.
  // Sur bail_perdu, on ne libere JAMAIS : le bail appartient a l'execution
  // qui l'a repris.
  await admin
    .from('calendar_sources')
    .update({ sync_lease_until: null })
    .eq('workspace_id', workspaceId)
    .eq('google_calendar_id', googleCalendarId);
}

async function stampError(admin: Admin, workspaceId: string, googleCalendarId: string, message: string, currentToken: string): Promise<void> {
  // Poser last_error et liberer le bail — mais UNIQUEMENT si nous le
  // detenons encore (WHERE sync_lease_until = jeton). Sinon on ne touche a
  // rien : l'execution qui detient le bail decidera de l'etat.
  await admin
    .from('calendar_sources')
    .update({
      last_error:       message,
      sync_lease_until: null,
    })
    .eq('workspace_id', workspaceId)
    .eq('google_calendar_id', googleCalendarId)
    .eq('sync_lease_until', currentToken);
}

async function loadSource(admin: Admin, workspaceId: string, googleCalendarId: string): Promise<{
  is_conflict: boolean; still_present: boolean; active_generation: number;
} | null> {
  const { data, error } = await admin
    .from('calendar_sources')
    .select('is_conflict, still_present, active_generation')
    .eq('workspace_id', workspaceId)
    .eq('google_calendar_id', googleCalendarId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    is_conflict:       data.is_conflict === true,
    still_present:     data.still_present === true,
    active_generation: Number(data.active_generation ?? 0),
  };
}

async function loadActiveGeneration(admin: Admin, workspaceId: string, googleCalendarId: string): Promise<number | null> {
  const { data, error } = await admin
    .from('calendar_sources')
    .select('active_generation')
    .eq('workspace_id', workspaceId)
    .eq('google_calendar_id', googleCalendarId)
    .maybeSingle();
  if (error || !data) return null;
  return Number(data.active_generation ?? 0);
}

async function loadRefreshToken(admin: Admin, workspaceId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('calendar_connections')
    .select('refresh_token_encrypted')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return decrypt(data.refresh_token_encrypted);
  } catch {
    return null;
  }
}

const INSERT_BATCH_SIZE = 500;

export async function runFullSyncForSource(input: RunFullSyncInput): Promise<RunFullSyncOutcome> {
  const admin = input.admin ?? makeAdmin();
  const now   = input.now   ?? new Date();
  const ws  = input.workspaceId;
  const cal = input.googleCalendarId;

  // (a) prise de bail — le jeton est la chaine ISO exacte posee.
  let token = await tryAcquireLease(admin, ws, cal, now);
  if (!token) return { ok: false, reason: 'bail_occupe' };

  // (b) source eligible ?
  const preSrc = await loadSource(admin, ws, cal);
  if (!preSrc || !preSrc.is_conflict || !preSrc.still_present) {
    await releaseLease(admin, ws, cal);
    return { ok: false, reason: 'source_non_eligible' };
  }

  // (c) jeton refresh
  const refreshToken = await loadRefreshToken(admin, ws);
  if (!refreshToken) {
    await stampError(admin, ws, cal, 'jeton_indisponible', token);
    return { ok: false, reason: 'jeton_indisponible' };
  }

  // (d) lecture Google
  const win = windowIso(now);
  let events:            CalendarEvent[];
  let nextSyncToken:     string | null;
  let ignoredFromGoogle: SyncIgnored;
  try {
    const result = await listEventsWindow({
      refreshToken,
      calendarId: cal,
      timeMin:    win.timeMin,
      timeMax:    win.timeMax,
    });
    events            = result.events;
    nextSyncToken     = result.nextSyncToken;
    ignoredFromGoogle = result.ignored;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'echec_google';
    await stampError(admin, ws, cal, msg, token);
    return { ok: false, reason: 'echec_google' };
  }

  // Apres Google — AVANT toute ecriture :
  //   1. relire la source (c'est active_generation qu'on vient y chercher) ;
  //   2. prolonger le bail par un update conditionne
  //      `WHERE sync_lease_until = jeton`. Zero ligne → bail_perdu : le bail
  //      ne nous appartient plus, on n'ecrit rien et on ne libere rien.
  //
  // LA POSSESSION EST DECIDEE PAR LA BASE, JAMAIS ICI. Une comparaison
  // JavaScript entre le jeton pose et la valeur relue comparerait deux
  // REPRESENTATIONS d'un meme instant : le client rend `+00:00` la ou
  // toISOString() produit `Z`. Elle sortait donc en bail_perdu a CHAQUE
  // passage, sans erreur ecrite et sans donnee — mesure en production le
  // 19/08/2026. La condition equivalente existe cote base, sur des valeurs
  // timestamptz, et elle est representation-independante.
  const postSrc = await loadSource(admin, ws, cal);
  if (!postSrc) return { ok: false, reason: 'bail_perdu' };
  const extended = await extendLease(admin, ws, cal, token);
  if (!extended) return { ok: false, reason: 'bail_perdu' };
  token = extended;

  // (e) generation cible recalculee sur l'active_generation RELU.
  //
  // ECART DOCUMENTAIRE, SIGNALE ET NON CORRIGE ICI : le commentaire de tete
  // de la migration 094 decrit la bascule comme active_generation + 1. Le
  // schema (smallint) n'impose rien ; l'implementation utilise l'alternance
  // binaire pour eviter tout debordement. Le commentaire de 094 sera repris
  // dans un lot ulterieur ; ce lot ne modifie pas 094.
  const target = postSrc.active_generation === 0 ? 1 : 0;

  // Avant la suppression de la generation cible : revalider bail + verifier
  // que la generation active n'a pas deja bascule sur notre cible.
  const preDeleteExtend = await extendLease(admin, ws, cal, token);
  if (!preDeleteExtend) return { ok: false, reason: 'bail_perdu' };
  token = preDeleteExtend;
  const preDeleteGen = await loadActiveGeneration(admin, ws, cal);
  if (preDeleteGen === null || preDeleteGen === target) {
    // Un autre acteur a bascule sur notre cible — ne pas ecrire ni purger.
    return { ok: false, reason: 'bail_perdu' };
  }

  // (1) supprimer le residu potentiel de la generation cible
  const del = await admin
    .from('external_busy')
    .delete()
    .eq('workspace_id', ws)
    .eq('google_calendar_id', cal)
    .eq('generation', target);
  if (del.error) {
    await stampError(admin, ws, cal, 'echec_google', token);
    return { ok: false, reason: 'echec_google' };
  }

  // (2) inserer le nouveau jeu par lots de 500. Avant CHAQUE lot : bail +
  // active_generation revalides.
  let written = 0;
  for (let i = 0; i < events.length; i += INSERT_BATCH_SIZE) {
    const preBatchExtend = await extendLease(admin, ws, cal, token);
    if (!preBatchExtend) return { ok: false, reason: 'bail_perdu' };
    token = preBatchExtend;
    const preBatchGen = await loadActiveGeneration(admin, ws, cal);
    if (preBatchGen === null || preBatchGen === target) {
      return { ok: false, reason: 'bail_perdu' };
    }

    const slice = events.slice(i, i + INSERT_BATCH_SIZE);
    const rows = slice.map(e => ({
      workspace_id:       ws,
      google_calendar_id: cal,
      generation:         target,
      google_event_id:    e.id,
      starts_at:          e.startsAt,
      ends_at:            e.endsAt,
      transparency:       e.transparency,
    }));
    const ins = await admin.from('external_busy').insert(rows);
    if (ins.error) {
      await stampError(admin, ws, cal, 'echec_google', token);
      return { ok: false, reason: 'echec_google' };
    }
    written += rows.length;
  }

  // (3) bascule finale conditionnee au bail : WHERE ... AND sync_lease_until = jeton.
  const swap = await admin
    .from('calendar_sources')
    .update({
      active_generation: target,
      last_sync_at:      now.toISOString(),
      sync_pending:      false,
      sync_token:        nextSyncToken,
      last_error:        null,
      sync_lease_until:  null,
    })
    .eq('workspace_id', ws)
    .eq('google_calendar_id', cal)
    .eq('sync_lease_until', token)
    .select('google_calendar_id');
  if (swap.error) {
    // Cas rare : erreur PostgREST autre. On ne touche pas last_error de
    // maniere inconditionnelle, on tente une pose conditionnee au bail.
    await stampError(admin, ws, cal, 'echec_google', token);
    return { ok: false, reason: 'echec_google' };
  }
  if (!Array.isArray(swap.data) || swap.data.length === 0) {
    // Le bail a ete repris pendant l'ecriture : rien n'est reussi de notre
    // cote, on ne touche a rien d'autre.
    return { ok: false, reason: 'bail_perdu' };
  }

  // (4) purge des lignes external_busy hors de la generation cible.
  const purge = await admin
    .from('external_busy')
    .delete()
    .eq('workspace_id', ws)
    .eq('google_calendar_id', cal)
    .neq('generation', target);
  if (purge.error) {
    // La bascule a eu lieu ; la purge finale peut etre retentee au prochain
    // tour. On signale l'echec technique dans last_error mais on ne peut
    // plus revenir en arriere sur la bascule.
    return { ok: false, reason: 'echec_google' };
  }

  return {
    ok:                  true,
    reason:              'sync_ok',
    written,
    ignored:             ignoredFromGoogle,
    nextSyncTokenStored: nextSyncToken !== null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// mirror_ready — recalcul global d'un espace.
// ─────────────────────────────────────────────────────────────────────────────

export type RecomputeInput = {
  workspaceId: string;
  admin?:      Admin;
  now?:        Date;
};

export type RecomputeOutcome = {
  mirror_ready: boolean;
  first_full_sync_done_at_touched: boolean;
};

export async function recomputeMirrorReady(input: RecomputeInput): Promise<RecomputeOutcome> {
  const admin = input.admin ?? makeAdmin();
  const now   = input.now   ?? new Date();

  const { data, error } = await admin
    .from('calendar_sources')
    .select('is_conflict, last_sync_at, sync_pending')
    .eq('workspace_id', input.workspaceId);
  if (error) return { mirror_ready: false, first_full_sync_done_at_touched: false };

  const rows = (data ?? []) as Array<{ is_conflict: boolean; last_sync_at: string | null; sync_pending: boolean }>;
  const conflicts = rows.filter(r => r.is_conflict === true);

  let ready = false;
  if (conflicts.length > 0) {
    ready = conflicts.every(r => r.last_sync_at !== null && r.sync_pending === false);
  }

  const state = await admin
    .from('calendar_sync_state')
    .select('mirror_ready, first_full_sync_done_at')
    .eq('workspace_id', input.workspaceId)
    .maybeSingle();

  const patch: Record<string, unknown> = { mirror_ready: ready };
  let firstFullSyncTouched = false;
  if (ready && (!state.data?.first_full_sync_done_at)) {
    patch.first_full_sync_done_at = now.toISOString();
    firstFullSyncTouched = true;
  }

  if (state.data) {
    await admin
      .from('calendar_sync_state')
      .update(patch)
      .eq('workspace_id', input.workspaceId);
  } else {
    await admin
      .from('calendar_sync_state')
      .insert({ workspace_id: input.workspaceId, ...patch });
  }

  return { mirror_ready: ready, first_full_sync_done_at_touched: firstFullSyncTouched };
}

// ─────────────────────────────────────────────────────────────────────────────
// readMirrorFreshness — expose des FAITS sur la fraicheur du miroir.
//
// LC21 (3)A — RESULTAT DISCRIMINE PAR LE TYPE.
//
// L'ancienne signature rendait un quadruplet muet, et encodait une ERREUR DE
// LECTURE des sources comme « zero source de conflit » :
//     if (srcsErr) return { conflict_sources: 0, ..., mirror_ready: false };
// Un espace sans calendrier selectionne rendait EXACTEMENT le meme objet. Ces
// deux situations n'ont pas la meme consequence produit — D27 : sur erreur on
// refuse, sur absence de source on sert normalement — et aucun appelant ne
// pouvait les distinguer.
//
// La forme est donc une UNION : soit les faits, soit un motif d'echec nomme.
// Le type OBLIGE l'appelant a traiter le cas. Un champ booleen optionnel se
// laisse ignorer en silence, et c'est exactement le mecanisme qui a produit le
// defaut du bail mesure le 19/08/2026.
//
// NE PREND AUCUNE DECISION. mirror_ready n'est PAS modifie en fonction du
// temps ecoule : la peremption est une LECTURE, appliquee par decideMirror au
// moment de decider, jamais une transformation de l'etat pose en base — D38 §9.
// ─────────────────────────────────────────────────────────────────────────────

export type MirrorFacts = {
  conflict_sources:    number;
  never_synced:        number;
  oldest_last_sync_at: string | null;
  mirror_ready:        boolean;
};

// Motifs d'echec, nommes par la LECTURE qui a echoue.
export type MirrorReadFailure = 'lecture_sources' | 'lecture_etat';

export type MirrorFreshnessResult =
  | { ok: true;  facts: MirrorFacts }
  | { ok: false; reason: MirrorReadFailure };

export type ReadMirrorFreshnessInput = {
  workspaceId: string;
  admin?:      Admin;
};

// Plus ancien last_sync_at, choisi par comparaison d'INSTANTS.
//
// L'ancienne version prenait le premier element d'un `.sort()` de CHAINES :
// deux representations d'un meme instant s'y comparaient comme du texte, meme
// famille de defaut que celui du bail. Une valeur non parsable est ecartee du
// choix — elle ne peut pas etre datee, donc pas etre « la plus ancienne ».
function oldestInstant(values: Array<string | null>): string | null {
  let bestIso: string | null = null;
  let bestMs  = Number.POSITIVE_INFINITY;
  for (const v of values) {
    if (typeof v !== 'string' || v.length === 0) continue;
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) continue;
    if (ms < bestMs) { bestMs = ms; bestIso = v; }
  }
  return bestIso;
}

export async function readMirrorFreshness(input: ReadMirrorFreshnessInput): Promise<MirrorFreshnessResult> {
  const admin = input.admin ?? makeAdmin();

  // `!srcs` est teste avec l'erreur, patron TD-005 : PostgREST rend `[]` (jamais
  // null) pour un resultat vide reussi. Un `data` null sans erreur est une
  // anomalie, et elle ne doit pas se lire comme « aucune source ».
  const { data: srcs, error: srcsErr } = await admin
    .from('calendar_sources')
    .select('last_sync_at')
    .eq('workspace_id', input.workspaceId)
    .eq('is_conflict',   true)
    .eq('still_present', true);
  if (srcsErr || !srcs) return { ok: false, reason: 'lecture_sources' };

  const rows = srcs as Array<{ last_sync_at: string | null }>;
  const conflict_sources    = rows.length;
  const never_synced        = rows.filter(r => r.last_sync_at === null).length;
  const oldest_last_sync_at = oldestInstant(rows.map(r => r.last_sync_at));

  // L'erreur de lecture de l'etat global etait AVALEE : `state.data?.…` la
  // rendait indiscernable d'un miroir non pret. Elle est desormais nommee.
  const state = await admin
    .from('calendar_sync_state')
    .select('mirror_ready')
    .eq('workspace_id', input.workspaceId)
    .maybeSingle();
  if (state.error) return { ok: false, reason: 'lecture_etat' };
  const mirror_ready = state.data?.mirror_ready === true;

  return { ok: true, facts: { conflict_sources, never_synced, oldest_last_sync_at, mirror_ready } };
}


// ─────────────────────────────────────────────────────────────────────────────
// decideMirror — LE DECIDEUR. Fonction PURE : aucune E/S, aucune horloge
// implicite. `now` et le seuil sont des entrees.
//
// L'ORDRE D'EVALUATION EST LA DECISION, et il est arbitre (Max, 19/08/2026) :
//   1. echec de lecture                                  -> refuser
//   2. conflict_sources = 0                              -> ignorer
//   3. mirror_ready faux                                  -> refuser
//   4. never_synced > 0, ou plus ancien last_sync_at nul  -> refuser
//   5. age > seuil                                        -> refuser
//   6. sinon                                              -> utiliser
//
// LE POINT 2 DOIT PRECEDER LE POINT 3, et ce n'est pas un detail de style :
// recomputeMirrorReady rend mirror_ready = false quand il n'y a AUCUNE source
// de conflit. Inverser l'ordre ferait refuser tout espace sans calendrier
// raccorde — c'est-a-dire tous les espaces d'aujourd'hui.
//
// « ignorer » n'est PAS « libre » : il signifie que le miroir n'a rien a dire
// sur cet espace, et que la disponibilite se decide sans lui — D5, absence de
// donnee ne vaut pas conflit, et reciproquement.
// ─────────────────────────────────────────────────────────────────────────────

export type MirrorRefusal =
  | 'lecture_impossible'
  | 'miroir_non_pret'
  | 'jamais_synchronise'
  | 'perime';

export type MirrorDecision =
  | { mode: 'ignorer';  motif: 'aucune_source_de_conflit' }
  | { mode: 'utiliser' }
  | { mode: 'refuser';  motif: MirrorRefusal };

export type DecideMirrorInput = {
  freshness:         MirrorFreshnessResult;
  now:               Date;
  staleAfterMinutes: number;
};

export function decideMirror(input: DecideMirrorInput): MirrorDecision {
  const { freshness, now, staleAfterMinutes } = input;

  if (!freshness.ok) return { mode: 'refuser', motif: 'lecture_impossible' };

  const f = freshness.facts;

  if (f.conflict_sources === 0) return { mode: 'ignorer', motif: 'aucune_source_de_conflit' };
  if (f.mirror_ready !== true)  return { mode: 'refuser', motif: 'miroir_non_pret' };
  if (f.never_synced > 0)       return { mode: 'refuser', motif: 'jamais_synchronise' };

  const oldestMs = f.oldest_last_sync_at === null ? NaN : Date.parse(f.oldest_last_sync_at);
  if (Number.isNaN(oldestMs))   return { mode: 'refuser', motif: 'jamais_synchronise' };

  const ageMinutes = (now.getTime() - oldestMs) / 60_000;
  if (ageMinutes > staleAfterMinutes) return { mode: 'refuser', motif: 'perime' };

  return { mode: 'utiliser' };
}


// ─────────────────────────────────────────────────────────────────────────────
// readMirrorBusy — les intervalles occupes du miroir, sur une plage.
//
// CE QUI SORT : le debut et la fin. RIEN D'AUTRE. google_event_id n'est jamais
// SELECTIONNE — pas filtre apres coup : jamais demande. Interdiction ecrite
// deux fois dans la migration 094, sur la table ET sur la colonne.
//
// LECTURE PAR SOURCE, SUR SA GENERATION ACTIVE : active_generation vit par
// source dans calendar_sources, donc external_busy ne se lit jamais seule.
// L'ordre des filtres suit l'index external_busy_read.
//
// RECOUVREMENT : starts_at < fin ET ends_at > debut — un evenement a cheval
// sur la plage bloque.
//
// TRANSPARENCE : `opaque` uniquement. Un evenement `transparent` est mirroite
// mais ne bloque pas : refuser dessus rendrait Mirvo plus restrictif que
// Google lui-meme.
//
// FAIL-CLOSED INTEGRAL — arbitrage de Max, 19/08/2026 : si la lecture echoue
// pour UNE SEULE source, le resultat global est un ECHEC. On ne rend JAMAIS
// les intervalles partiels des autres sources comme s'ils etaient complets :
// un jeu incomplet se lit comme « ce creneau est libre ».
//
// COURSE ENTRE L'INSTANTANE DE GENERATION ET LA LECTURE — fermee ici.
//
//   1. on lit les sources eligibles et leur active_generation ;
//   2. la tache planifiee peut, pendant nos lectures, BASCULER une source vers
//      l'autre generation puis PURGER l'ancienne ;
//   3. nos lectures portent alors sur une generation deja vidée ;
//   4. elles rendent [], et un jeu vide se lit « aucun conflit ».
//
// C'est un fail-open. La garde : on REPREND l'instantane apres toutes les
// lectures et on le compare mecaniquement au premier. Toute source apparue ou
// disparue, toute generation qui a bouge, rend un ECHEC GLOBAL nomme
// `generation_instable` — les intervalles deja lus ne sont jamais rendus.
//
// Ce n'est pas une transaction : la comparaison ne prouve pas qu'aucune
// bascule n'a eu lieu, elle prouve qu'aucune n'est OBSERVABLE de part et
// d'autre. Une bascule complete aller-retour entre les deux lectures resterait
// invisible — elle exigerait deux tours de synchronisation dans l'intervalle
// de quelques millisecondes qui separe nos deux requetes.
// ─────────────────────────────────────────────────────────────────────────────

export type MirrorBusyInterval = {
  starts_at: string;
  ends_at:   string;
};

export type MirrorBusyFailure = 'lecture_sources' | 'lecture_intervalles' | 'generation_instable';

// Empreinte mecanique d'un jeu de sources eligibles : identifiant et
// generation active, tries, donc independante de l'ordre rendu par la base.
function sourcesSnapshot(rows: Array<{ google_calendar_id: string; active_generation: number | null }>): string {
  return rows
    .map(r => `${r.google_calendar_id}#${Number(r.active_generation ?? 0)}`)
    .sort()
    .join('|');
}

export type MirrorBusyResult =
  | { ok: true;  intervals: MirrorBusyInterval[] }
  | { ok: false; reason: MirrorBusyFailure };

export type ReadMirrorBusyInput = {
  workspaceId: string;
  fromUtc:     Date;
  toUtc:       Date;
  admin?:      Admin;
};

export async function readMirrorBusy(input: ReadMirrorBusyInput): Promise<MirrorBusyResult> {
  const admin = input.admin ?? makeAdmin();

  const { data: srcs, error: srcsErr } = await admin
    .from('calendar_sources')
    .select('google_calendar_id, active_generation')
    .eq('workspace_id', input.workspaceId)
    .eq('is_conflict',   true)
    .eq('still_present', true);
  if (srcsErr || !srcs) return { ok: false, reason: 'lecture_sources' };

  const sources = srcs as Array<{ google_calendar_id: string; active_generation: number | null }>;
  const intervals: MirrorBusyInterval[] = [];

  for (const src of sources) {
    const { data, error } = await admin
      .from('external_busy')
      .select('starts_at, ends_at')
      .eq('workspace_id',       input.workspaceId)
      .eq('google_calendar_id', src.google_calendar_id)
      .eq('generation',         Number(src.active_generation ?? 0))
      .eq('transparency',       'opaque')
      .lt('starts_at',          input.toUtc.toISOString())
      .gt('ends_at',            input.fromUtc.toISOString());
    if (error || !data) return { ok: false, reason: 'lecture_intervalles' };

    for (const row of data as Array<{ starts_at: string; ends_at: string }>) {
      intervals.push({ starts_at: row.starts_at, ends_at: row.ends_at });
    }
  }

  // Reprise de l'instantane APRES toutes les lectures.
  const { data: after, error: afterErr } = await admin
    .from('calendar_sources')
    .select('google_calendar_id, active_generation')
    .eq('workspace_id', input.workspaceId)
    .eq('is_conflict',   true)
    .eq('still_present', true);
  if (afterErr || !after) return { ok: false, reason: 'lecture_sources' };

  const avant = sourcesSnapshot(sources);
  const apres = sourcesSnapshot(after as Array<{ google_calendar_id: string; active_generation: number | null }>);
  if (avant !== apres) return { ok: false, reason: 'generation_instable' };

  return { ok: true, intervals };
}
