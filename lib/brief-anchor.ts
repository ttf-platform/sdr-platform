import { localInstantUTC } from './local-day'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// Morning Coffee Brief — LOT B, CORRECTIF B1 : la FENETRE DE NOUVEAUTE.
//
// Module PUR. Aucun I/O. Calcule le `sinceISO` de la lecture `signals`,
// c'est-a-dire la borne basse « tout ce qui s'est passe depuis le dernier
// brief cron reellement ENVOYE ».
//
// Vit hors de la route parce que AUCUN test de route n'existe dans ce repo
// (0 fichier de test sous `app/`) — inlinier ce calcul le rendrait
// invisible aux gates, comme il l'etait dans la premiere version du lot B :
// le repli de 7 jours etait passe au minimum avec l'ancre, donc applique
// inconditionnellement (l'ancre d'un compte actif est TOUJOURS plus recente
// que « il y a 7 j » → le min rendait `fallbackMs` a chaque fois → un
// signal du lundi declenchait un envoi lundi + mardi + mercredi + jeudi +
// vendredi et rebelote le lundi suivant, cinq a six envois pour UN
// evenement — economie du lot B annulee).
//
// ─── Regles ───────────────────────────────────────────────────────────────
//
//   Pas d'ancre (ou `emailed_at` nul/difforme)   → deadline − 7 j (repli)
//   Ancre valide, brief_date exploitable         → min(emailed_at, echeance)
//   Ancre valide, brief_date nul/difforme        → emailed_at seul
//
// L'echeance du brief precedent (`localInstantUTC(tz, brief_date, briefTime)`)
// est ANTERIEURE a son `emailed_at` (etape 13 = apres un appel modele qui
// peut durer jusqu'a 240 s). Sans elle, un signal detecte pendant la
// generation n'est ni dans le brief du jour, ni apres l'ancre le
// lendemain — il est perdu pour toujours.
//
// PAS de plancher sur l'ancienneté de l'ancre : un compte silencieux depuis
// trois mois produit une fenetre de trois mois, c'est bien « tout ce qui
// s'est passe depuis le dernier brief ». Le cout de la requete est borne
// par `.limit(SIGNALS_QUERY_LIMIT)` dans `buildSignals`.
//
// L'echeance est reconstruite avec le `briefTime` et le fuseau
// D'AUJOURD'HUI — le repo ne les historise pas. Si l'utilisateur recule son
// heure de livraison apres un envoi, le `min` retombe sur `emailed_at` et
// les signaux detectes pendant la generation precedente (quelques minutes)
// sont perdus. Nomme, non corrige — corriger exigerait une colonne de plus.

export const ANCHOR_FALLBACK_DAYS = 7

export type BriefAnchorRow = {
  emailed_at: string | null
  brief_date: string | null
}

export function computeSinceISO(args: {
  deadline:  Date
  timezone:  string
  briefTime: string
  anchor:    BriefAnchorRow | null
}): string {
  const { deadline, timezone, briefTime, anchor } = args
  const fallbackMs = deadline.getTime() - ANCHOR_FALLBACK_DAYS * 86_400_000

  // 🔴 Le repli des 7 jours est ICI et NULLE PART AILLEURS. Le passer en
  // second operande du minimum plus bas le rendrait inconditionnel —
  // c'etait le defaut de la premiere version du lot B (l'ancre d'un
  // compte actif est toujours plus recente que « il y a 7 j »).
  const emailedMs = anchor?.emailed_at ? Date.parse(anchor.emailed_at) : NaN
  if (!Number.isFinite(emailedMs)) return new Date(fallbackMs).toISOString()

  // 🔴 `try/catch` autour de `localInstantUTC` : mesure — sur une
  // brief_date difforme (ex. '32/13/2026') il jette un RangeError. Le
  // repli est `emailedMs` seul, PAS les 7 jours — l'ancre existe.
  //
  // `briefTime.slice(0, 5)` : la colonne est un `time` PostgreSQL et
  // arrive en 'HH:MM:SS' ; `localInstantUTC` attend 'HH:MM'.
  let dueMs = NaN
  if (anchor?.brief_date) {
    try { dueMs = localInstantUTC(timezone, anchor.brief_date, briefTime.slice(0, 5)).getTime() }
    catch { dueMs = NaN }
  }

  const chosen = Number.isFinite(dueMs) ? Math.min(emailedMs, dueMs) : emailedMs
  return new Date(chosen).toISOString()
}
