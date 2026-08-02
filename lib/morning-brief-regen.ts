// ─── Scope ────────────────────────────────────────────────────────────────
//
// Decide, given the state of a workspace's briefs and today's meetings,
// whether the manual « generate / regenerate » button on the Morning Brief
// screen should be enabled, and — if so — what to generate.
//
// Pur : aucun React, aucun Supabase, aucun HTTP. Prend l'ecran ET la route
// (§1.4 : la route recalcule cote serveur avec le meme module — le client
// peut mentir, un appel modele force est paye).
//
// La regle produit, telle qu'enoncee par Max :
//   1. Premier jour d'un compte (aucun brief jamais recu) : bouton actif,
//      brief ENTIER (veille + suggestions + preparation eventuelle).
//   2. Chaque matin, l'envoi automatique produit le brief entier.
//   3. Plus tard, un NOUVEAU rendez-vous du jour meme rallume le bouton et
//      produit un document RENDEZ-VOUS SEULEMENT (tous les RDV du jour,
//      ceux deja prepares le matin PLUS les nouveaux).
//   4. Aucun nouveau rendez-vous du jour → bouton grise.
//
// ⚠️ Arbitrage nomme, connu et accepte (§3 du brief) : un rendez-vous booke
// PENDANT la generation n'est pas rattrape. `morning_briefs.created_at` est
// pose a l'INSERT, apres un appel modele qui peut durer jusqu'a 240 s. Un
// rendez-vous entre dans cette fenetre a un horodatage anterieur a l'ancre
// → bouton gris. A quatre comptes internes et une fenetre de quelques
// dizaines de secondes, on l'accepte. A NE PAS CORRIGER ici.

export type RegenDecision =
  | { enabled: true;  kind: 'full';          reason: 'first_ever' | 'no_brief_today' }
  | { enabled: true;  kind: 'meetings_only'; reason: 'new_meeting' }
  | { enabled: false; reason: 'no_new_meeting' }

export interface TodayMeetingInput {
  createdAt:   string
  confirmedAt: string | null
}

export interface RegenDecisionInput {
  everReceivedBrief:    boolean
  /**
   * `emailed_at` de la ligne cron du jour, s'il y en a une. Trace le moment
   * ou l'envoi automatique du matin a REELLEMENT parti.
   * 🔴 Ne jamais utiliser SEUL comme ancre : une regeneration manuelle ne
   * le fait pas bouger, le bouton resterait allume en permanence apres un
   * envoi auto suivi d'un reclic.
   */
  todayCronEmailedAt:   string | null
  /**
   * `created_at` du dernier brief pose aujourd'hui, tous types confondus
   * (manuel ou cron). Necessaire pour que la regeneration manuelle deplace
   * l'ancre — voir garde du point precedent.
   */
  todayBriefCreatedAt:  string | null
  /**
   * Rendez-vous du jour local, statut `scheduled`. Pour chacun, on lit LES
   * DEUX horodatages : `createdAt` (moment de la reservation, double
   * opt-in inclus) ET `confirmedAt` (moment de la confirmation via
   * confirm_booking). L'horodatage d'entree effective d'un rendez-vous
   * dans la journee est le PLUS TARD des deux — un RDV reserve a 6h50 et
   * confirme a 9h est entre dans la journee a 9h.
   */
  todayMeetings:        TodayMeetingInput[]
}

/**
 * Instant utile d'un rendez-vous : le plus tard de createdAt et
 * confirmedAt. Pour un booking public en double opt-in, la reservation
 * ne compte QUE quand elle est confirmee — la ligne existe en `pending`
 * avant. `confirmedAt` peut etre nul (rendez-vous cree directement par
 * l'owner, deja `scheduled`).
 */
function meetingEntryMs(m: TodayMeetingInput): number {
  const created = Date.parse(m.createdAt)
  const confirmed = m.confirmedAt ? Date.parse(m.confirmedAt) : NaN
  if (Number.isNaN(created) && Number.isNaN(confirmed)) return -Infinity
  if (Number.isNaN(confirmed)) return created
  if (Number.isNaN(created))   return confirmed
  return Math.max(created, confirmed)
}

export function decideRegen(input: RegenDecisionInput): RegenDecision {
  const {
    everReceivedBrief,
    todayCronEmailedAt,
    todayBriefCreatedAt,
    todayMeetings,
  } = input

  // Regle 1 : jamais recu de brief → bouton actif, brief entier.
  if (!everReceivedBrief) {
    return { enabled: true, kind: 'full', reason: 'first_ever' }
  }

  // Regle 2 : l'ancre est le PLUS TARD de emailed_at (cron) et created_at
  // (dernier brief pose aujourd'hui). JAMAIS `Math.max(undefined, x)` : ca
  // rend NaN, et toute comparaison ulterieure avec NaN est fausse — le
  // bouton serait eteint pour toujours. Neutre `-Infinity`, puis tester
  // « les deux nuls » separement pour aiguiller vers la regle 3.
  const emailedMs = todayCronEmailedAt   ? Date.parse(todayCronEmailedAt)   : Number.NaN
  const createdMs = todayBriefCreatedAt  ? Date.parse(todayBriefCreatedAt)  : Number.NaN
  const hasAnchor = !Number.isNaN(emailedMs) || !Number.isNaN(createdMs)
  const anchorMs = Math.max(
    Number.isNaN(emailedMs) ? -Infinity : emailedMs,
    Number.isNaN(createdMs) ? -Infinity : createdMs,
  )

  // Regle 3 : compte historique, mais aucune trace de brief aujourd'hui.
  // Cron rate. On rend le brief ENTIER (pas la preparation seule) — un
  // document rendez-vous seulement ferait perdre la veille du jour.
  if (!hasAnchor) {
    return { enabled: true, kind: 'full', reason: 'no_brief_today' }
  }

  // Regle 4 : un rendez-vous est nouveau si son horodatage d'entree
  // (max de createdAt et confirmedAt) est STRICTEMENT POSTERIEUR a
  // l'ancre. Le double opt-in fait qu'un RDV reserve a 6h50 et confirme
  // a 9h est entre dans la journee a 9h — avec createdAt seul il serait
  // invisible.
  for (const m of todayMeetings) {
    if (meetingEntryMs(m) > anchorMs) {
      return { enabled: true, kind: 'meetings_only', reason: 'new_meeting' }
    }
  }

  // Regle 5 : rien de nouveau.
  return { enabled: false, reason: 'no_new_meeting' }
}
