// ─── Scope ────────────────────────────────────────────────────────────────
//
// Deux helpers TOTAUX pour l'écran Morning Brief (lot 5a) — la logique vit
// dans lib/ plutôt que dans le composant pour être testable, et sortie de
// tout couplage React. Aucun import : pur.
//
// `normalizeHalfHour`   ramène une chaîne « HH:MM » sur la grille
//                       {`:00`, `:30`}, en respectant la contrainte de la
//                       migration 090 (workspace_profiles_morning_brief_time
//                       _half_hour) : jamais `24:00`. Une entrée illisible
//                       retombe silencieusement sur `07:30` (défaut de
//                       l'écran) plutôt que de jeter.
// `toInputTime`         coupe une valeur Postgres `HH:MM:SS` à ses 5 premiers
//                       caractères pour l'`<input type="time">`. Défensif :
//                       `null` casté, chaîne trop courte → `07:30`.
//
// Trois niveaux CUMULATIFS d'assainissement de l'heure :
//   1. `step={1800}` sur l'input                 (indice UI, contournable)
//   2. normalizeHalfHour au onBlur, côté client  (voulu par l'utilisateur)
//   3. regex du schéma Zod côté serveur          (400 propre)
// Et en base : la contrainte CHECK reste la source de vérité, même si les
// trois niveaux au-dessus tombent.

const DEFAULT_TIME = '07:30'

/**
 * Ramène une chaîne « HH:MM » sur la grille des demi-heures.
 * Règle : arrondi à la demi-heure INFÉRIEURE dès que la minute est ≥ 15 sous
 * un multiple de 30, sinon on garde le multiple précédent. Concrètement :
 *   `[0..14]`  → `:00`
 *   `[15..44]` → `:30`
 *   `[45..59]` → heure suivante `:00`, sauf `23:45`-`23:59` → `23:30` pour
 *   ne jamais franchir la borne `24:00` de la contrainte CHECK.
 * Toute entrée non parsable → `07:30`.
 */
export function normalizeHalfHour(value: string): string {
  if (typeof value !== 'string') return DEFAULT_TIME
  const m = value.slice(0, 5).match(/^(\d{2}):(\d{2})$/)
  if (!m) return DEFAULT_TIME
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return DEFAULT_TIME
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return DEFAULT_TIME

  let outH = hh
  let outM: 0 | 30
  if (mm < 15)       outM = 0
  else if (mm < 45)  outM = 30
  else {
    // `:45`-`:59` → normalement heure suivante `:00`. Mais `23:45`-`23:59`
    // se contenteraient alors de `24:00`, refusé par la contrainte CHECK.
    // Cas limite : on rabat sur `23:30` (la dernière valeur légale).
    if (hh === 23) { outM = 30 }
    else           { outH = hh + 1; outM = 0 }
  }
  return `${String(outH).padStart(2, '0')}:${outM === 0 ? '00' : '30'}`
}

/**
 * Coupe une valeur Postgres `time` (rendue en `HH:MM:SS`) aux 5 premiers
 * caractères, formant `HH:MM` pour un `<input type="time">`. Défensif : une
 * chaîne trop courte, `null` casté, ou une entrée non conforme retombent
 * sur `07:30` (la valeur par défaut UI).
 */
export function toInputTime(dbValue: string): string {
  if (typeof dbValue !== 'string') return DEFAULT_TIME
  const first5 = dbValue.slice(0, 5)
  return /^([01]\d|2[0-3]):(00|30)$/.test(first5) ? first5 : DEFAULT_TIME
}
