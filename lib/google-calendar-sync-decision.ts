/**
 * lib/google-calendar-sync-decision.ts
 *
 * LC21 (4)A — DEUX DECIDEURS PURS pour la synchronisation Google, cinquieme et
 * sixieme livrables du lot. Ces fonctions n'appellent RIEN et n'ecrivent RIEN :
 * elles produisent des verdicts et des triplets d'etat que (4)B persistera.
 *
 *   decideAfterConflict — verdict apres 409 sur createEvent (I5)
 *   nextSyncState       — transition d'etat vers { sync_status, attempts,
 *                         next_attempt_at } (regle d'etat, prescriptive)
 *
 * PORTEE : aucun appelant applicatif au moment de la livraison. Le socle est
 * inerte ; (4)B invoquera ces fonctions depuis sa tache planifiee.
 *
 * INERTIE ET SEPARATION : decideAfterConflict recoit la charge utile Google
 * DEJA lue. Elle n'invoque JAMAIS getEvent — l'appel appartient a (4)B. Cette
 * separation ferme structurellement le finding par lequel le succes de la
 * verification et son echec se confondraient.
 */

import type { GoogleEventPayload, GoogleErrorClass } from '@/lib/google-calendar-client';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de recul exponentiel — PROVISOIRES, ajustables par (4)B apres
// mesure reelle. Exportees pour lisibilite par les tests de (4)A et (4)B.
// ─────────────────────────────────────────────────────────────────────────────

/** Delai de base (secondes) : le premier recul apres un premier echec. */
export const RETRY_BASE_SECONDS = 60;

/** Facteur multiplicatif : delai(n) = base * facteur^(n-1). */
export const RETRY_FACTOR = 2;

/** Plafond de tentatives : au-dela, l'etat devient 'failed_permanent'. */
export const RETRY_MAX_ATTEMPTS = 6;

// ─────────────────────────────────────────────────────────────────────────────
// decideAfterConflict — I5, quatre conditions cumulatives, PURE.
//
// Ne recoit qu'une lecture ABOUTIE. Un echec de getEvent n'entre PAS ici — il
// est gouverne par nextSyncState via sa propre classification d'erreur. La
// fonction ne peut donc jamais confondre "lecture aboutie qui refuse" et
// "lecture qui n'a pas repondu".
// ─────────────────────────────────────────────────────────────────────────────

export type DecideAfterConflictInput = {
  /** Charge utile Google, DEJA lue par (4)B. events.get retourne toujours
   *  l'evenement, cancelled compris — le decideur juge sur status et donnees. */
  fetchedEvent: GoogleEventPayload;

  /** Triplet attendu, source autoritative :
   *   - expectedWorkspaceId provient de meetings.workspace_id, JAMAIS de la
   *     table d'etat meeting_google_sync (I5 §condition 1).
   *   - expectedMeetingId provient de meetings.id.
   *   - expectedEnvironmentRef est derive de NEXT_PUBLIC_SUPABASE_URL au
   *     moment de la construction du marqueur d'insertion (I4). */
  expectedWorkspaceId:    string;
  expectedMeetingId:      string;
  expectedEnvironmentRef: string;

  /** Creneau attendu. La comparaison se fait en INSTANTS (Date.parse), jamais
   *  en chaines — famille representation-contre-instant, cf. le correctif de
   *  (2)c #391. */
  expectedStartsAt: string;
  expectedEndsAt:   string;
};

export type DecideAfterConflictOutcome =
  | { verdict: 'synced' }
  | { verdict: 'failed'; reason:
        | 'missing_ownership_marker'
        | 'workspace_mismatch'
        | 'meeting_mismatch'
        | 'environment_mismatch'
        | 'status_cancelled'
        | 'time_mismatch'
        | 'unreadable_time' };

/**
 * Applique les QUATRE conditions cumulatives de I5 sur une lecture ABOUTIE.
 * Les quatre reunies : `synced`. Une seule manquante : `failed` avec son motif.
 *
 * PURE. Aucune donnee personnelle n'est retournee : le motif est un code d'un
 * jeu ferme, jamais un texte.
 */
export function decideAfterConflict(input: DecideAfterConflictInput): DecideAfterConflictOutcome {
  const priv = input.fetchedEvent.extendedProperties?.private;

  // Normalise a minuscules pour la comparaison — cohesion avec I4 (le marqueur
  // est ecrit en minuscules par createEvent).
  const gotWs  = (priv?.mirvo_workspace_id    ?? '').toLowerCase();
  const gotMtg = (priv?.mirvo_meeting_id      ?? '').toLowerCase();
  const gotEnv = (priv?.mirvo_environment_ref ?? '').toLowerCase();

  const expWs  = input.expectedWorkspaceId.toLowerCase();
  const expMtg = input.expectedMeetingId.toLowerCase();
  const expEnv = input.expectedEnvironmentRef.toLowerCase();

  // Absence complete du marqueur = evenement etranger.
  if (!gotWs && !gotMtg && !gotEnv) {
    return { verdict: 'failed', reason: 'missing_ownership_marker' };
  }

  // Condition 1 : bon workspace (verifie contre meetings.workspace_id).
  if (gotWs !== expWs) return { verdict: 'failed', reason: 'workspace_mismatch' };
  // Condition 2 : bon meeting.
  if (gotMtg !== expMtg) return { verdict: 'failed', reason: 'meeting_mismatch' };
  // Condition 3 : bon environnement.
  if (gotEnv !== expEnv) return { verdict: 'failed', reason: 'environment_mismatch' };

  // Condition 4a : status vivant.
  if (input.fetchedEvent.status === 'cancelled') {
    return { verdict: 'failed', reason: 'status_cancelled' };
  }

  // Condition 4b : creneau correspondant, compare en INSTANTS.
  const gotStart = input.fetchedEvent.start?.dateTime;
  const gotEnd   = input.fetchedEvent.end?.dateTime;
  if (!gotStart || !gotEnd) {
    // Les rendez-vous Mirvo sont horodates (non all-day) : l'absence de
    // dateTime est un motif propre, distinct de time_mismatch.
    return { verdict: 'failed', reason: 'unreadable_time' };
  }
  const gotStartMs = Date.parse(gotStart);
  const gotEndMs   = Date.parse(gotEnd);
  const expStartMs = Date.parse(input.expectedStartsAt);
  const expEndMs   = Date.parse(input.expectedEndsAt);
  if (
    Number.isNaN(gotStartMs) || Number.isNaN(gotEndMs) ||
    Number.isNaN(expStartMs) || Number.isNaN(expEndMs)
  ) {
    return { verdict: 'failed', reason: 'unreadable_time' };
  }
  if (gotStartMs !== expStartMs || gotEndMs !== expEndMs) {
    return { verdict: 'failed', reason: 'time_mismatch' };
  }

  return { verdict: 'synced' };
}

// ─────────────────────────────────────────────────────────────────────────────
// nextSyncState — regle d'etat prescrite, PURE.
//
// Entree : outcome de la tentative (succes ou classe d'erreur retournee par
// classifyError, plus le verdict decideAfterConflict le cas echeant), et le
// nombre de tentatives DEJA effectuees (>=1 apres la premiere tentative).
//
// Sortie : le triplet { sync_status, attempts, next_attempt_at } que (4)B
// persistera. Le cas 'pending' est celui pose a la creation par (4)B ; (4)A
// ne le produit jamais.
//
// INTERDICTION STRUCTURELLE : le chemin `409 -> lecture 429/5xx -> failed_permanent`
// est FAUX et ne doit pas exister. Une erreur Google temporaire se retente,
// quelle que soit le 409 qui l'a precedee. Un `failed_permanent` apres un 409
// n'est autorise QUE lorsque la lecture a ABOUTI et prouve une incompatibilite
// permanente.
// ─────────────────────────────────────────────────────────────────────────────

export type NextSyncStateInput =
  | {
      /** Succes : insertion 2xx, ou verdict decideAfterConflict === 'synced'. */
      kind: 'success';
      attemptsSoFar: number;
      now: Date;
    }
  | {
      /** Echec sur la tentative d'insertion elle-meme. */
      kind: 'insertError';
      errorClass: Exclude<GoogleErrorClass, 'deja_present'>;
      attemptsSoFar: number;
      now: Date;
    }
  | {
      /** 409 sur l'insertion, PUIS lecture de verification ABOUTIE, PUIS
       *  decideAfterConflict a rendu 'failed'. Cas terminal. */
      kind: 'conflictVerifiedIncompatible';
      attemptsSoFar: number;
      now: Date;
    }
  | {
      /** 409 sur l'insertion, PUIS lecture de verification EN ECHEC. Le sort
       *  est gouverne par CETTE erreur, jamais par le 409. */
      kind: 'conflictVerifyError';
      errorClass: Exclude<GoogleErrorClass, 'deja_present'>;
      attemptsSoFar: number;
      now: Date;
    };

export type NextSyncStateOutcome = {
  sync_status:     'synced' | 'failed' | 'failed_permanent';
  attempts:        number;
  next_attempt_at: string | null;
};

function backoffFrom(now: Date, attemptsSoFar: number): string {
  // delai(n) = base * facteur^(n-1), en secondes.
  const n = Math.max(1, attemptsSoFar);
  const seconds = RETRY_BASE_SECONDS * Math.pow(RETRY_FACTOR, n - 1);
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

export function nextSyncState(input: NextSyncStateInput): NextSyncStateOutcome {
  switch (input.kind) {
    case 'success':
      return {
        sync_status:     'synced',
        attempts:        input.attemptsSoFar,
        next_attempt_at: null,
      };

    case 'insertError':
      if (input.errorClass === 'permanent') {
        return {
          sync_status:     'failed_permanent',
          attempts:        input.attemptsSoFar,
          next_attempt_at: null,
        };
      }
      // rejouable
      if (input.attemptsSoFar >= RETRY_MAX_ATTEMPTS) {
        return {
          sync_status:     'failed_permanent',
          attempts:        input.attemptsSoFar,
          next_attempt_at: null,
        };
      }
      return {
        sync_status:     'failed',
        attempts:        input.attemptsSoFar,
        next_attempt_at: backoffFrom(input.now, input.attemptsSoFar),
      };

    case 'conflictVerifiedIncompatible':
      // Cas terminal : lecture ABOUTIE et decidee incompatible.
      return {
        sync_status:     'failed_permanent',
        attempts:        input.attemptsSoFar,
        next_attempt_at: null,
      };

    case 'conflictVerifyError':
      // La classe de CETTE erreur (verify) prime — jamais le 409 qui l'a precede.
      if (input.errorClass === 'permanent') {
        return {
          sync_status:     'failed_permanent',
          attempts:        input.attemptsSoFar,
          next_attempt_at: null,
        };
      }
      // rejouable
      if (input.attemptsSoFar >= RETRY_MAX_ATTEMPTS) {
        return {
          sync_status:     'failed_permanent',
          attempts:        input.attemptsSoFar,
          next_attempt_at: null,
        };
      }
      return {
        sync_status:     'failed',
        attempts:        input.attemptsSoFar,
        next_attempt_at: backoffFrom(input.now, input.attemptsSoFar),
      };
  }
}
