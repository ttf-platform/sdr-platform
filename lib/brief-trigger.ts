import type { BriefPayload } from './brief-payload'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// Refonte Morning Coffee Brief — LOT B : la GARDE de trigger.
//
// Module PUR. Aucun I/O. Aucun logging. Prend un `BriefPayload` (lot A) et
// dit si le cron doit envoyer le brief au workspace, ou passer son tour.
//
// ─── Regle produit (verrouillee avec Max) ─────────────────────────────────
//
// AVANT lot B : le cron envoie le brief chaque jour ouvre, meme si rien
// n'a change depuis la veille (contenu genere, e-mail envoye, aucune
// nouvelle information reelle). Consequence : desabonnements + reveil de
// dossier vide pour rien.
//
// APRES lot B : le brief part SEULEMENT si quelque chose de NEUF le
// justifie. La distinction cle est EVENEMENT vs ETAT :
//
//   EVENEMENTS (declenchent) :
//     - meetings                 — rendez-vous du jour local (a preparer)
//     - pending                  — rendez-vous en attente d'expiration
//     - signals                  — signaux detectes depuis la derniere ancre
//     - deliverabilityTriggering — bounces eleves / erreur fournisseur
//                                  (change d'un jour a l'autre)
//
//   ETATS permanents (ne declenchent PAS) :
//     - hotReplies               — reponses non lues qui restent tant qu'on
//                                  ne les traite pas (ne « rentrent » pas
//                                  chaque matin)
//     - suggestion               — suggestion de campagne non consommee
//                                  (idem : reste dispo tant qu'ignoree)
//     - deliverability reason='capacity_reached' — plafond quotidien
//                                                  toujours atteint, meme
//                                                  cause chaque jour
//
//   Cas particuliers :
//     - hadError                 — au moins un bloc a rate sa lecture ;
//                                  FAIL-OPEN, on envoie plutot que masquer
//                                  un rendez-vous reel
//     - !hasEverSent (first_brief) — on a jamais rien envoye ; envoyer au
//                                  moins une fois pour poser le rythme
//                                  (SAUF si hadError, verifie AVANT)
//
// Le contenu de l'e-mail est INCHANGE : ce module dit UNIQUEMENT si
// l'e-mail part, pas ce qu'il contient. Les modes A/B/C du render restent
// tels quels (lot 5b-bis).

export type TriggerVerdict =
  | { send: true;  reason: 'meetings' | 'pending' | 'signals' | 'deliverability' | 'read_error' | 'first_brief' }
  | { send: false; reason: 'nothing_new' }

export type TriggerInput = BriefPayload & { hasEverSent: boolean }

export function shouldSendBrief(p: TriggerInput): TriggerVerdict {
  // ORDRE VOLONTAIRE :
  //
  // 1. read_error EN TETE. Si un bloc a rate sa lecture, on ne peut pas
  //    savoir si un evenement existe ou pas — FAIL-OPEN : on envoie. Meme
  //    a la premiere fois (l'ecran d'erreur vaut mieux que le silence).
  //
  // 2. first_brief APRES read_error. Un workspace qui n'a jamais rien
  //    recu doit voir arriver au moins un brief pour poser le rythme,
  //    meme si sa journee est reellement vide. Mais si la lecture a echoue,
  //    on prefere `read_error` (plus informatif au niveau observabilite).
  //
  // 3. Les 4 evenements ensuite, dans l'ordre du payload (arbitraire mais
  //    stable — le premier vrai gagne).
  //
  // 4. `nothing_new` en dernier — l'etat par defaut.
  if (p.hadError)      return { send: true, reason: 'read_error' }
  if (!p.hasEverSent)  return { send: true, reason: 'first_brief' }

  if (p.meetings.length > 0)                 return { send: true, reason: 'meetings' }
  if (p.pending.length  > 0)                 return { send: true, reason: 'pending' }
  if (p.signals.length  > 0)                 return { send: true, reason: 'signals' }
  // 🔴 Consulter `totals.deliverabilityTriggering`, JAMAIS
  // `deliverability.length` ni `deliverability.some(...)` : le `.slice(...)`
  // du bloc (e) plafonne a 3 elements — un workspace avec 4 boites en
  // `capacity_reached` verrait `deliverability.length === 3` alors qu'aucune
  // de ces alertes n'est un evenement declencheur.
  if (p.totals.deliverabilityTriggering > 0) return { send: true, reason: 'deliverability' }

  return { send: false, reason: 'nothing_new' }
}
