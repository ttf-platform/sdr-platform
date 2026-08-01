// ─── Scope ────────────────────────────────────────────────────────────────
//
// Arithmétique de journée locale (« quel jour civil, en `tz`, à quel instant
// UTC ? »). Module STRICTEMENT PUR : aucun import, ni relatif ni `@/`. Il
// peut donc entrer dans un bundle client sans traîner un module serveur
// (lib/morning-brief tire logAiCall → createAdminClient, et surtout porte
// le texte des consignes de modèle qui nomment les fournisseurs interdits :
// on ne veut ni l'un ni l'autre au navigateur).
//
// Déplacement à l'identique depuis lib/morning-brief.ts (lot 5a) — corps
// byte-identical, seuls les commentaires ont été condensés et regroupés
// dans ce scope.

// ── UTC bounds of "today" in an IANA timezone ────────────────────────────
//
// Renvoie l'instant UTC du premier tick de la journée locale dans `tz`,
// l'instant du dernier tick, et la date locale en « YYYY-MM-DD ».
//
// Le décalage n'est PAS échantillonné à `now` mais à l'instant estimé de
// minuit local, en deux passes : une graine (décalage à midi UTC de la date
// locale, jamais un résultat, seulement un point d'ancrage), puis un second
// tir à l'instant que la graine désigne. Les jours de bascule DST, minuit
// local et l'heure d'échantillonnage vivent souvent de part et d'autre de
// la transition — l'ancien code (échantillon unique à `now`) glissait alors
// d'une heure sur les deux bornes.
//
// La fin de journée se calcule comme « premier tick du lendemain − 1 ms »,
// jamais en construisant « 23 h 59 min 59 s » avec un décalage : les jours
// de bascule d'automne où l'heure recule pile à minuit (mesuré : Santiago,
// 4 avril 2026), la journée locale dure 25 heures et « 23 h 59 min 59 s »
// existe deux fois. Toute formulation partant de la fin de journée tombe
// sur la première occurrence et ampute une heure réelle.
//
// Propriété : le résultat ne dépend de `now` que par la date locale qu'il
// désigne. Deux `now` du même jour local rendent exactement les mêmes
// bornes — anti-régression garantie par les tests dédiés.
//
// `now` est un paramètre optionnel pour rendre la fonction testable de
// manière déterministe : le repo n'utilise nulle part de fausses horloges
// (vi.useFakeTimers absent), on copie donc le patron de convertNaiveLocalToUtc
// (meeting-tz.ts) qui reçoit ses instants en argument.
// Décalage horaire d'un fuseau à un instant précis, formaté « +HH:MM » /
// « -HH:MM » (jamais « GMT+... »). Hoisted au niveau module pour être
// réutilisable par localInstantUTC (lot 4) — la version précédente était une
// clôture qui capturait `tz`, la hoister sans le paramètre est littéralement
// impossible.
function offsetAt(tz: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(instant)
  const raw = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const m = raw.match(/GMT([+-]\d{2}:\d{2})/)
  return m ? m[1] : '+00:00'
}

// Instant UTC désigné par une heure murale locale (`hhmm` = « HH:MM ») dans
// `tz`, à la date locale `dateStr` (« YYYY-MM-DD »). Technique à deux passes
// mesurée sur 45 fuseaux × 400 jours × 4 réglages = 72 000 combinaisons →
// ZÉRO instant invalide.
//
// Comportements aux transitions DST, mesurés et attendus :
//  - heure locale INEXISTANTE (passage à l'heure d'été, ex. Paris 2026-03-29
//    02:30) : la valeur retournée correspond à l'heure demandée « décalée de
//    la durée du trou » — le premier instant après le trou est 03:00, pas
//    02:30 → l'assertion locale à 03:30 est ce que rend Intl.
//  - heure locale DÉDOUBLÉE (retour à l'heure d'hiver, ex. Paris 2026-10-25
//    02:30) : la SECONDE occurrence est choisie (CET), pas la première (CEST).
//  - bascule PILE À MINUIT (Santiago 2026-04-04) : la fonction rend l'instant
//    correct des deux formes (00:30 local et minuit — cohérent).
//  - décalage fractionnaire `:45` (Kathmandu +05:45) : préservé.
//  - `tz` invalide : Intl jette un `RangeError`. La fonction ne rattrape pas
//    — la décision est prise chez l'appelant (dueBriefDate = 'bad_timezone' ;
//    todayBoundsUTC laisse remonter). Les deux régimes sont volontaires.
export function localInstantUTC(tz: string, dateStr: string, hhmm: string): Date {
  const seed = offsetAt(tz, new Date(`${dateStr}T12:00:00Z`))
  const refined = offsetAt(tz, new Date(`${dateStr}T${hhmm}:00${seed}`))
  return new Date(`${dateStr}T${hhmm}:00${refined}`)
}

export function todayBoundsUTC(
  tz: string,
  now: Date = new Date(),
): { start: Date; end: Date; dateStr: string } {
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: tz }) // "YYYY-MM-DD"

  const nextDateStr = new Date(Date.parse(`${dateStr}T00:00:00Z`) + 86_400_000)
    .toISOString().slice(0, 10)

  return {
    start:   localInstantUTC(tz, dateStr,     '00:00'),
    end:     new Date(localInstantUTC(tz, nextDateStr, '00:00').getTime() - 1),
    dateStr,
  }
}
