import { localInstantUTC } from './morning-brief'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// Décisions d'ordonnancement du cron Morning Coffee Brief : est-ce que ce
// workspace est dû à cette exécution du cron ? Le brief_date à écrire, le
// « trop tard » calé sur la fenêtre de rattrapage, la garde week-end, la
// garde d'inactivité.
//
// Module purement décisionnel : aucun import de next/server, aucun Supabase,
// aucun Resend. Se teste comme signal-digest / morning-brief-email, avec
// `now` explicite (pas de vi.useFakeTimers, absent du repo).
//
// Les trois fonctions sont TOTALES : elles ne jettent jamais, quelle que
// soit l'entrée. Un fuseau invalide ou une valeur difforme est signalée par
// la structure de retour, non par une exception — un cron qui plante sur un
// compte ne doit pas empêcher les autres d'être servis.

/**
 * Fenêtre de rattrapage : deux heures. Un compte dont l'échéance a été ratée
 * (fenêtre Vercel manquée, contenu vide, erreur temporaire) reste éligible
 * pendant deux heures — soit exactement quatre réveils du cron `*​/30`. Après,
 * `too_late` : l'utilisateur aura son brief le lendemain plutôt que de
 * recevoir « bonjour » à midi.
 */
export const CATCH_UP_MS     = 2 * 60 * 60 * 1000

/**
 * Seuil d'inactivité : trente jours sans connexion. La garde existe pour ne
 * pas payer un appel modèle à quelqu'un qui ne lira pas.
 */
export const INACTIVITY_DAYS = 30

export type DueVerdict =
  | { due: true;  briefDate: string; deadline: Date }
  | { due: false; reason: 'not_yet' | 'too_late' | 'bad_timezone' | 'bad_time' }

// Ajoute `days` (positif ou négatif) à une date locale en YYYY-MM-DD sans
// jamais soustraire 24 h à un instant : les journées de 23 h (spring-forward)
// et de 25 h (fall-back) existent, donc `now - 24h` ne cible pas la veille
// dans tous les cas. Passer par `Date.UTC` fabrique une arithmétique de
// calendrier absolue.
function addDaysToDateStr(dateStr: string, days: number): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return dateStr
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const next = new Date(utc + days * 86_400_000)
  return next.toISOString().slice(0, 10)
}

/**
 * Décide si un workspace est dû à cette exécution du cron.
 *
 * Deux échéances évaluées : celle du jour local, celle de la veille. La veille
 * couvre le cas où les réveils du soir ont échoué et où le rattrapage tombe
 * après minuit local. Elle ne rattrape PAS un compte à `23:30` qui recevrait
 * son brief le jour même (mesuré : le réveil de `23:30` local le jour même
 * est éligible dans tous les fuseaux).
 *
 * Comparaison en instants absolus : `now >= deadline` ET
 * `now - deadline < CATCH_UP_MS`. JAMAIS une égalité sur l'heure locale, sinon
 * un fuseau à décalage `:45` ne tomberait sur aucune frontière de demi-heure
 * du cron `*​/30` et ne serait servi jamais.
 *
 * Borne haute STRICTE : à `deadline + 2 h` pile, `too_late`. Mesuré, cela
 * donne exactement quatre tentatives (aux réveils `+0`, `+30`, `+60`, `+90`).
 */
export function dueBriefDate(args: {
  timeZone:  string
  briefTime: string | null | undefined
  now:       Date
}): DueVerdict {
  const { timeZone, briefTime, now } = args

  // 1. Parse robuste de briefTime. Postgres rend « HH:MM:SS » ; on prend les
  //    5 premiers caractères. `bad_time` couvre nul, forme incorrecte, hors
  //    bornes. On NE rejette PAS une minute hors {0, 30} : la contrainte
  //    CHECK de la migration 090 le garantit en amont, et rejeter ici
  //    transformerait une donnée légale en panne silencieuse.
  const raw = typeof briefTime === 'string' ? briefTime.slice(0, 5) : ''
  const hm = raw.match(/^(\d{2}):(\d{2})$/)
  if (!hm) return { due: false, reason: 'bad_time' }
  const hh = Number(hm[1])
  const mm = Number(hm[2])
  if (hh > 23 || mm > 59) return { due: false, reason: 'bad_time' }
  const hhmm = raw

  // 2. Tout le calcul dans un try — un `tz` invalide fait jeter Intl et doit
  //    être renvoyé PAR COMPTE, pas remonter dans la boucle du cron.
  try {
    const todayLocal = now.toLocaleDateString('en-CA', { timeZone })
    const yesterdayLocal = addDaysToDateStr(todayLocal, -1)

    const deadlineToday     = localInstantUTC(timeZone, todayLocal,     hhmm)
    const deadlineYesterday = localInstantUTC(timeZone, yesterdayLocal, hhmm)

    const nowMs = now.getTime()

    // Jour d'abord (le cas dominant), veille ensuite (rattrapage post-minuit).
    // Mesuré : jamais dues simultanément.
    const deltaToday = nowMs - deadlineToday.getTime()
    if (deltaToday >= 0 && deltaToday < CATCH_UP_MS) {
      return { due: true, briefDate: todayLocal, deadline: deadlineToday }
    }

    const deltaYesterday = nowMs - deadlineYesterday.getTime()
    if (deltaYesterday >= 0 && deltaYesterday < CATCH_UP_MS) {
      return { due: true, briefDate: yesterdayLocal, deadline: deadlineYesterday }
    }

    // Ni due jour, ni due veille : diagnostic.
    if (deltaToday < 0) return { due: false, reason: 'not_yet' }
    return { due: false, reason: 'too_late' }
  } catch {
    return { due: false, reason: 'bad_timezone' }
  }
}

/**
 * `true` iff `dateStr` (YYYY-MM-DD, date CIVILE locale) désigne un samedi ou
 * dimanche. `dateStr` est déjà une date locale — il n'y a rien à reprojeter :
 * on désigne le jour civil via midi UTC (un point d'ancrage stable). Chaîne
 * non parsable → `false`, non fatal (une erreur amont ne doit pas déclencher
 * une garde week-end fantôme).
 */
export function isWeekendDate(dateStr: string): boolean {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  const d = new Date(`${dateStr}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return false
  const day = d.getUTCDay()
  return day === 0 || day === 6
}

/**
 * `true` iff le compte n'a pas signé depuis `INACTIVITY_DAYS` jours ou plus.
 *
 * 🔴 Un `lastSignInAt` absent, `null`, `undefined`, ou non parsable rend
 * `false` (donc ON ENVOIE). La garde existe pour ne pas payer un modèle à
 * quelqu'un qui ne lit pas. Une valeur absente n'est pas « il ne lit pas »,
 * c'est « on ne sait pas ». Faire taire la fonctionnalité sur un inconnu la
 * casserait silencieusement pour un compte légitime, alors que l'envoyer
 * coûte un appel. L'asymétrie des risques tranche dans ce sens.
 *
 * Seuil INCLUSIF : exactement 30 jours sans connexion → inactif.
 */
export function isInactive(lastSignInAt: string | null | undefined, now: Date): boolean {
  if (lastSignInAt == null) return false
  const t = Date.parse(lastSignInAt)
  if (Number.isNaN(t)) return false
  const deltaMs = now.getTime() - t
  return deltaMs >= INACTIVITY_DAYS * 86_400_000
}
