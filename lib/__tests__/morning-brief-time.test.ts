import { describe, expect, it } from 'vitest'
import { normalizeHalfHour, toInputTime } from '../morning-brief-time'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// normalizeHalfHour et toInputTime sont deux helpers TOTAUX du lot 5a. Ces
// tests verrouillent :
//   - la règle « ramener à la demi-heure » sur la grille exacte de la
//     contrainte CHECK 090 (jamais `24:00`) ;
//   - la totalité : aucune entrée difforme ne jette, elle retombe sur
//     `07:30` (le défaut UI) ;
//   - le croisement sur les 1 440 minutes d'une journée : chaque sortie
//     satisfait `/^([01]\d|2[0-3]):(00|30)$/`.

const HALF_HOUR_REGEX = /^([01]\d|2[0-3]):(00|30)$/

describe('normalizeHalfHour', () => {
  it("'07:00' → '07:00'", () => expect(normalizeHalfHour('07:00')).toBe('07:00'))
  it("'07:12' → '07:00'", () => expect(normalizeHalfHour('07:12')).toBe('07:00'))
  it("'07:14' → '07:00'", () => expect(normalizeHalfHour('07:14')).toBe('07:00'))
  it("'07:15' → '07:30'", () => expect(normalizeHalfHour('07:15')).toBe('07:30'))
  it("'07:44' → '07:30'", () => expect(normalizeHalfHour('07:44')).toBe('07:30'))
  it("'07:45' → '08:00'", () => expect(normalizeHalfHour('07:45')).toBe('08:00'))
  it("'23:44' → '23:30'", () => expect(normalizeHalfHour('23:44')).toBe('23:30'))
  it("'23:45' → '23:30' (JAMAIS '24:00' — borne haute de la contrainte CHECK)", () => {
    expect(normalizeHalfHour('23:45')).toBe('23:30')
  })
  it("'23:59' → '23:30' (idem — la borne haute est stricte)", () => {
    expect(normalizeHalfHour('23:59')).toBe('23:30')
  })
  it("'00:07' → '00:00'", () => expect(normalizeHalfHour('00:07')).toBe('00:00'))
  it("'12:30' → '12:30'", () => expect(normalizeHalfHour('12:30')).toBe('12:30'))

  it("'' → '07:30' SANS exception (défaut UI)", () => {
    expect(() => normalizeHalfHour('')).not.toThrow()
    expect(normalizeHalfHour('')).toBe('07:30')
  })
  it("'abc' → '07:30' SANS exception", () => {
    expect(() => normalizeHalfHour('abc')).not.toThrow()
    expect(normalizeHalfHour('abc')).toBe('07:30')
  })
  it("'25:00' → '07:30' SANS exception (heure hors bornes)", () => {
    expect(() => normalizeHalfHour('25:00')).not.toThrow()
    expect(normalizeHalfHour('25:00')).toBe('07:30')
  })

  it('croisement 1 440 minutes : chaque sortie respecte la contrainte CHECK 090, jamais "24:00", zéro exception', () => {
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m++) {
        const input = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
        let out = ''
        expect(() => { out = normalizeHalfHour(input) }).not.toThrow()
        expect(HALF_HOUR_REGEX.test(out)).toBe(true)
        expect(out).not.toBe('24:00')
      }
    }
  })
})

describe('toInputTime', () => {
  it("'07:30:00' → '07:30' (format Postgres)", () => {
    expect(toInputTime('07:30:00')).toBe('07:30')
  })
  it("'07:30' → '07:30' (déjà court)", () => {
    expect(toInputTime('07:30')).toBe('07:30')
  })
  it("'' → '07:30' (défaut UI, sans exception)", () => {
    expect(() => toInputTime('')).not.toThrow()
    expect(toInputTime('')).toBe('07:30')
  })
  it("null casté → '07:30' SANS exception", () => {
    expect(() => toInputTime(null as unknown as string)).not.toThrow()
    expect(toInputTime(null as unknown as string)).toBe('07:30')
  })
  it("valeur hors grille (ex. '07:12:00') → '07:30' (fallback strict à la contrainte CHECK)", () => {
    // toInputTime est appelé au chargement depuis la base — la base ne peut
    // pas rendre '07:12' (contrainte CHECK), mais en défensif : si un jour
    // la contrainte tombait, l'écran reste opérationnel.
    expect(toInputTime('07:12:00')).toBe('07:30')
  })
})
