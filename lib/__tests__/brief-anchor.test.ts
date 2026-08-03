import { describe, expect, it } from 'vitest'
import { computeSinceISO, ANCHOR_FALLBACK_DAYS, type BriefAnchorRow } from '../brief-anchor'
import { TIMEZONES } from '../timezones'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// Verrouille le calcul du `sinceISO` de la fenetre de nouveaute (correctif
// B1). Le defaut d'origine (repli de 7 j dans le `Math.min` → applique
// inconditionnellement, un signal produit 5-6 envois au lieu d'un) est
// attrape par cinq des huit assertions du tableau et par le test explicite
// « la fenetre suit l'ancre, elle n'est pas fixe ».

const DEADLINE   = new Date('2026-08-03T05:30:00Z')
const TZ         = 'Europe/Paris'
const BRIEF_TIME = '07:30:00'

// Repli 7 jours a partir de la deadline — utilise dans 3 des 8 cas.
const FALLBACK_ISO = new Date(DEADLINE.getTime() - ANCHOR_FALLBACK_DAYS * 86_400_000).toISOString()

describe("computeSinceISO — table de verite du correctif B1", () => {
  it("pas d'ancre → repli 7 jours", () => {
    const out = computeSinceISO({ deadline: DEADLINE, timezone: TZ, briefTime: BRIEF_TIME, anchor: null })
    expect(out).toBe(FALLBACK_ISO)
  })

  it("emailed_at nul → repli 7 jours", () => {
    const anchor: BriefAnchorRow = { emailed_at: null, brief_date: '2026-08-02' }
    const out = computeSinceISO({ deadline: DEADLINE, timezone: TZ, briefTime: BRIEF_TIME, anchor })
    expect(out).toBe(FALLBACK_ISO)
  })

  it("emailed_at difforme → repli 7 jours", () => {
    const anchor: BriefAnchorRow = { emailed_at: 'pas-une-date', brief_date: '2026-08-02' }
    const out = computeSinceISO({ deadline: DEADLINE, timezone: TZ, briefTime: BRIEF_TIME, anchor })
    expect(out).toBe(FALLBACK_ISO)
  })

  it("nominal — l'echeance (07:30 Paris) gagne sur emailed_at (05:34 UTC)", () => {
    const anchor: BriefAnchorRow = { emailed_at: '2026-08-02T05:34:11Z', brief_date: '2026-08-02' }
    const out = computeSinceISO({ deadline: DEADLINE, timezone: TZ, briefTime: BRIEF_TIME, anchor })
    expect(out).toBe('2026-08-02T05:30:00.000Z')
  })

  it("brief_date nul → emailed_at seul (pas de repli 7 j)", () => {
    const anchor: BriefAnchorRow = { emailed_at: '2026-08-02T05:34:11Z', brief_date: null }
    const out = computeSinceISO({ deadline: DEADLINE, timezone: TZ, briefTime: BRIEF_TIME, anchor })
    expect(out).toBe('2026-08-02T05:34:11.000Z')
  })

  it("brief_date difforme → emailed_at seul, ne jette pas", () => {
    const anchor: BriefAnchorRow = { emailed_at: '2026-08-02T05:34:11Z', brief_date: '32/13/2026' }
    const out = computeSinceISO({ deadline: DEADLINE, timezone: TZ, briefTime: BRIEF_TIME, anchor })
    expect(out).toBe('2026-08-02T05:34:11.000Z')
  })

  it("echeance posterieure a l'envoi (briefTime=22:00) → emailed_at seul", () => {
    const anchor: BriefAnchorRow = { emailed_at: '2026-08-02T05:34:11Z', brief_date: '2026-08-02' }
    const out = computeSinceISO({ deadline: DEADLINE, timezone: TZ, briefTime: '22:00:00', anchor })
    expect(out).toBe('2026-08-02T05:34:11.000Z')
  })

  it("ancre vieille de 3 mois → fenetre de 3 mois (pas de plancher)", () => {
    const anchor: BriefAnchorRow = { emailed_at: '2026-05-04T05:34:00Z', brief_date: '2026-05-04' }
    const out = computeSinceISO({ deadline: DEADLINE, timezone: TZ, briefTime: BRIEF_TIME, anchor })
    expect(out).toBe('2026-05-04T05:30:00.000Z')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Invariant qui aurait attrape le defaut
// ═══════════════════════════════════════════════════════════════════════════
//
// La fenetre SUIT l'ancre — elle n'est pas fixe. Sur la version fautive
// (repli 7 j dans le `Math.min`), deux ancres differentes rendent le meme
// `sinceISO` : le test tombe. Verrou plus resistant qu'une valeur
// tabulaire aux fixtures.

describe("invariant — la fenetre suit l'ancre, elle n'est pas fixe", () => {
  it("deux ancres differentes → deux sinceISO differents", () => {
    const a = computeSinceISO({
      deadline: DEADLINE, timezone: TZ, briefTime: BRIEF_TIME,
      anchor: { emailed_at: '2026-08-02T05:34:11Z', brief_date: '2026-08-02' },
    })
    const b = computeSinceISO({
      deadline: DEADLINE, timezone: TZ, briefTime: BRIEF_TIME,
      anchor: { emailed_at: '2026-07-30T05:34:11Z', brief_date: '2026-07-30' },
    })
    expect(a).not.toBe(b)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Balayage — 44 fuseaux × 9 jours × 48 heures locales = 19 008 combinaisons
// ═══════════════════════════════════════════════════════════════════════════
//
// Sur chaque combinaison : aucune exception, sinceISO parseable, sinceISO
// <= emailed_at TOUJOURS. Aucune valeur de « fenetre max » assertee —
// elle depend entierement du montage et ne prouve rien.
//
// Jours choisis : 4 bascules DST (Chile, Australia, Paris printemps + automne),
// 2 bascules US (mars + novembre), plus 4 dates bornes de l'annee.

const SWEEP_DAYS = [
  '2026-04-05', '2026-09-27',
  '2026-03-29', '2026-10-25',
  '2026-03-08', '2026-11-01',
  '2026-02-28', '2026-12-31',
  '2026-01-01',
]

const SWEEP_HHMM: string[] = []
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    SWEEP_HHMM.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
}

describe("balayage 44 fuseaux × 9 jours × 48 hhmm — invariants seuls", () => {
  for (const tz of TIMEZONES) {
    for (const day of SWEEP_DAYS) {
      for (const hhmm of SWEEP_HHMM) {
        it(`${tz} ${day} ${hhmm}`, () => {
          const emailedAt = `${day}T12:00:00.000Z`
          const emailedMs = Date.parse(emailedAt)
          const deadline  = new Date(emailedMs + 86_400_000)
          const anchor: BriefAnchorRow = { emailed_at: emailedAt, brief_date: day }
          const out = computeSinceISO({ deadline, timezone: tz, briefTime: `${hhmm}:00`, anchor })
          const outMs = Date.parse(out)
          expect(Number.isFinite(outMs)).toBe(true)
          expect(outMs).toBeLessThanOrEqual(emailedMs)
        })
      }
    }
  }
})
