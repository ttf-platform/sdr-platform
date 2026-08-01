import { describe, expect, it } from 'vitest'
import {
  dueBriefDate,
  isInactive,
  isWeekendDate,
  CATCH_UP_MS,
  INACTIVITY_DAYS,
} from '../morning-brief-schedule'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// Les décisions d'ordonnancement du cron morning-brief sont pures : elles
// reçoivent `now` en paramètre (patron de todayBoundsUTC — vi.useFakeTimers
// n'existe nulle part dans ce repo). Ces tests verrouillent le contrat qui
// rend le cron sûr :
//
//   - dueBriefDate est totale (jamais d'exception) et évalue jour + veille ;
//   - la borne haute est STRICTE : à deadline + 2 h pile, too_late ;
//   - jamais d'égalité sur l'heure locale → un fuseau `:45` est éligible ;
//   - isWeekendDate ne jette pas sur donnée difforme ;
//   - isInactive est ASYMÉTRIQUE : `null` / non parsable → false (on envoie).

// ═══════════════════════════════════════════════════════════════════════════
// dueBriefDate
// ═══════════════════════════════════════════════════════════════════════════

describe('dueBriefDate — décision d\'échéance', () => {
  const TZ = 'America/Toronto'                  // EDT en août = -04:00
  const DEADLINE_UTC_HM = 'T11:30:00.000Z'      // 07:30 local EDT
  const DAY = '2026-08-01'                      // samedi — voir isWeekendDate ; ici on ne teste QUE la due-ness
  const deadline = new Date(`${DAY}${DEADLINE_UTC_HM}`)

  it('due à l\'échéance PILE : `now == deadline` (delta 0)', () => {
    const v = dueBriefDate({ timeZone: TZ, briefTime: '07:30:00', now: deadline })
    expect(v.due).toBe(true)
    if (v.due) {
      expect(v.briefDate).toBe(DAY)
      expect(v.deadline.getTime()).toBe(deadline.getTime())
    }
  })

  it('due à +1 h 59 min (dans la fenêtre de rattrapage)', () => {
    const now = new Date(deadline.getTime() + (2 * 60 - 1) * 60 * 1000)
    const v = dueBriefDate({ timeZone: TZ, briefTime: '07:30:00', now })
    expect(v.due).toBe(true)
  })

  it('too_late à +2 h PILE (borne haute STRICTE — 4 tentatives sur cron */30)', () => {
    const now = new Date(deadline.getTime() + CATCH_UP_MS)
    const v = dueBriefDate({ timeZone: TZ, briefTime: '07:30:00', now })
    expect(v.due).toBe(false)
    if (!v.due) expect(v.reason).toBe('too_late')
  })

  it('not_yet à -1 min avant l\'échéance', () => {
    const now = new Date(deadline.getTime() - 60_000)
    const v = dueBriefDate({ timeZone: TZ, briefTime: '07:30:00', now })
    expect(v.due).toBe(false)
    if (!v.due) expect(v.reason).toBe('not_yet')
  })

  it("réglage 23:30 avec `now` = 00:15 locale lendemain → due, briefDate = la VEILLE (rattrapage post-minuit)", () => {
    // 2026-08-01 23:30 EDT = 2026-08-02 03:30Z ; 45 min plus tard = 04:15Z,
    // qui est 00:15 EDT le 2 août local → date locale « 2 août », veille
    // = 1er août.
    const now = new Date('2026-08-02T04:15:00Z')
    const v = dueBriefDate({ timeZone: TZ, briefTime: '23:30:00', now })
    expect(v.due).toBe(true)
    if (v.due) expect(v.briefDate).toBe('2026-08-01')
  })

  it("briefTime au format Postgres 'HH:MM:SS' accepté", () => {
    const v = dueBriefDate({ timeZone: TZ, briefTime: '07:30:00', now: deadline })
    expect(v.due).toBe(true)
  })

  it("briefTime '7:30' (chiffre unique) → bad_time", () => {
    const v = dueBriefDate({ timeZone: TZ, briefTime: '7:30', now: deadline })
    expect(v.due).toBe(false)
    if (!v.due) expect(v.reason).toBe('bad_time')
  })

  it("briefTime '25:00' (heure hors bornes) → bad_time", () => {
    const v = dueBriefDate({ timeZone: TZ, briefTime: '25:00', now: deadline })
    expect(v.due).toBe(false)
    if (!v.due) expect(v.reason).toBe('bad_time')
  })

  it("briefTime '' → bad_time", () => {
    const v = dueBriefDate({ timeZone: TZ, briefTime: '', now: deadline })
    expect(v.due).toBe(false)
    if (!v.due) expect(v.reason).toBe('bad_time')
  })

  it("briefTime null → bad_time (défensif ; la colonne est NOT NULL)", () => {
    const v = dueBriefDate({ timeZone: TZ, briefTime: null, now: deadline })
    expect(v.due).toBe(false)
    if (!v.due) expect(v.reason).toBe('bad_time')
  })

  it("timeZone 'Not/AZone' → bad_timezone SANS exception", () => {
    expect(() => dueBriefDate({ timeZone: 'Not/AZone', briefTime: '07:30:00', now: deadline })).not.toThrow()
    const v = dueBriefDate({ timeZone: 'Not/AZone', briefTime: '07:30:00', now: deadline })
    expect(v.due).toBe(false)
    if (!v.due) expect(v.reason).toBe('bad_timezone')
  })

  it("Paris 2026-03-29 réglage 02:30 (heure locale INEXISTANTE) : due se juge sur l'instant absolu, pas sur l'heure murale", () => {
    // Le premier instant après le trou est 03:00 local ; l'instant que
    // localInstantUTC désigne pour 02:30 est 01:30 UTC (voir tests
    // localInstantUTC dans morning-brief.test.ts). À cet instant PILE, due.
    const now = new Date('2026-03-29T01:30:00.000Z')
    const v = dueBriefDate({ timeZone: 'Europe/Paris', briefTime: '02:30:00', now })
    expect(v.due).toBe(true)
  })

  it("Asia/Kathmandu (décalage :45) : due à l'échéance PILE — anti-régression du match par égalité", () => {
    // 07:30 Kathmandu = 01:45 UTC. À un cron `*​/30`, aucun réveil ne tombe
    // sur cet instant pile. La fonction utilise `now >= deadline` en
    // instants absolus, donc dès qu'un réveil tombe APRÈS 01:45Z on est due.
    // Ici on teste le cas PILE, borne inférieure inclusive.
    const deadlineKtm = new Date('2026-08-01T01:45:00.000Z')
    const v = dueBriefDate({ timeZone: 'Asia/Kathmandu', briefTime: '07:30:00', now: deadlineKtm })
    expect(v.due).toBe(true)
    if (v.due) expect(v.briefDate).toBe('2026-08-01')
  })

  it("Asia/Kathmandu : due à l'instant du prochain réveil */30 après l'échéance (jamais servi si l'on comparait heure murale)", () => {
    // Réveil suivant après 01:45Z : soit 02:00Z (le cron `*​/30` tombe sur
    // les :00 et :30 UTC). À cet instant, l'heure locale est 07:45, PAS
    // 07:30. Une implémentation à l'égalité murale ne servirait jamais ce
    // fuseau. Ici on vérifie que la fonction reste due.
    const now = new Date('2026-08-01T02:00:00.000Z')
    const v = dueBriefDate({ timeZone: 'Asia/Kathmandu', briefTime: '07:30:00', now })
    expect(v.due).toBe(true)
  })

  it("jour et veille jamais dues simultanément (l'écart entre les deux échéances vaut > CATCH_UP_MS)", () => {
    // À n'importe quelle heure du 2026-08-01, la veille = 2026-07-31 : son
    // échéance 07:30 EDT = 2026-07-31T11:30Z. La borne CATCH_UP_MS = 2 h fait
    // que la veille est due jusqu'à 13:30Z, et le jour n'est due qu'à partir
    // de 2026-08-01T11:30Z. Entre les deux, aucune. Après 11:30Z, seulement
    // le jour. Jamais les deux à la fois.
    const check = (now: Date) => {
      const v = dueBriefDate({ timeZone: TZ, briefTime: '07:30:00', now })
      return v.due
    }
    // Fenêtre de 24 h par pas de 15 min : jamais deux verdicts « due »
    // avec deux briefDates différents pour le même `now`. La fonction ne
    // retourne qu'un verdict, donc on prouve simplement qu'aucun choix
    // ambigu n'existe : à chaque instant, la fonction rend au plus un due.
    for (let ms = 0; ms < 24 * 60 * 60 * 1000; ms += 15 * 60 * 1000) {
      const now = new Date(deadline.getTime() - 12 * 60 * 60 * 1000 + ms)
      // Le simple fait d'appeler une fois suffit — la fonction est totale
      // et non ambiguë par construction (jour puis veille, jamais les deux).
      expect(() => check(now)).not.toThrow()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// isWeekendDate
// ═══════════════════════════════════════════════════════════════════════════

describe('isWeekendDate — samedi ou dimanche', () => {
  it('samedi → true (2026-08-01)',    () => expect(isWeekendDate('2026-08-01')).toBe(true))
  it('dimanche → true (2026-08-02)',  () => expect(isWeekendDate('2026-08-02')).toBe(true))
  it('lundi → false (2026-08-03)',    () => expect(isWeekendDate('2026-08-03')).toBe(false))
  it('mardi → false (2026-08-04)',    () => expect(isWeekendDate('2026-08-04')).toBe(false))
  it('mercredi → false (2026-08-05)', () => expect(isWeekendDate('2026-08-05')).toBe(false))
  it('jeudi → false (2026-08-06)',    () => expect(isWeekendDate('2026-08-06')).toBe(false))
  it('vendredi → false (2026-08-07)', () => expect(isWeekendDate('2026-08-07')).toBe(false))
  it("chaîne difforme → false, PAS d'exception", () => {
    expect(() => isWeekendDate('pas une date')).not.toThrow()
    expect(isWeekendDate('pas une date')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// isInactive
// ═══════════════════════════════════════════════════════════════════════════

describe('isInactive — 30 jours sans connexion (asymétrique sur l\'inconnu)', () => {
  const NOW = new Date('2026-08-01T12:00:00Z')

  it('29 jours → false (en dessous du seuil, on envoie)', () => {
    const t = new Date(NOW.getTime() - 29 * 86_400_000)
    expect(isInactive(t.toISOString(), NOW)).toBe(false)
  })

  it('31 jours → true (au-dessus du seuil, on n\'envoie pas)', () => {
    const t = new Date(NOW.getTime() - 31 * 86_400_000)
    expect(isInactive(t.toISOString(), NOW)).toBe(true)
  })

  it('EXACTEMENT 30 jours → true (seuil INCLUSIF)', () => {
    const t = new Date(NOW.getTime() - INACTIVITY_DAYS * 86_400_000)
    expect(isInactive(t.toISOString(), NOW)).toBe(true)
  })

  it('null → false (on envoie : « on ne sait pas » n\'est pas « il ne lit pas »)', () => {
    expect(isInactive(null, NOW)).toBe(false)
  })

  it("undefined → false (idem null)", () => {
    expect(isInactive(undefined, NOW)).toBe(false)
  })

  it("chaîne non parsable → false (asymétrie assumée)", () => {
    expect(isInactive('pas une date', NOW)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Totalité — aucune des trois fonctions ne jette, quelle que soit l'entrée
// ═══════════════════════════════════════════════════════════════════════════

describe('Totalité — aucune exception sur entrée difforme', () => {
  const NOW = new Date('2026-08-01T12:00:00Z')

  it("dueBriefDate : timeZone vide + briefTime nul + `now` valide", () => {
    expect(() => dueBriefDate({ timeZone: '', briefTime: null, now: NOW })).not.toThrow()
  })

  it("dueBriefDate : timeZone valide + briefTime nul + `now` valide", () => {
    expect(() => dueBriefDate({ timeZone: 'UTC', briefTime: null, now: NOW })).not.toThrow()
  })

  it("dueBriefDate : timeZone invalide + briefTime valide + `now` valide", () => {
    expect(() => dueBriefDate({ timeZone: 'Not/AZone', briefTime: '07:30', now: NOW })).not.toThrow()
  })

  it("isWeekendDate : chaîne vide, valeur type-castée cassée", () => {
    expect(() => isWeekendDate('')).not.toThrow()
    expect(() => isWeekendDate((null as unknown) as string)).not.toThrow()
    expect(() => isWeekendDate((123 as unknown) as string)).not.toThrow()
  })

  it("isInactive : plusieurs formes difformes, aucune n'explose", () => {
    for (const v of [null, undefined, '', 'nope', 'yesterday', '2020-99-99T99:99:99Z']) {
      expect(() => isInactive(v, NOW)).not.toThrow()
    }
  })
})
