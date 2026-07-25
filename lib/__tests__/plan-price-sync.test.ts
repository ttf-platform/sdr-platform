import { describe, it, expect } from 'vitest'
import { deriveAnnualDiscount, normalizeUnitAmount } from '../plan-price-sync'

describe('normalizeUnitAmount', () => {
  it('accepts positive finite numbers', () => {
    expect(normalizeUnitAmount(14900)).toBe(14900)
    expect(normalizeUnitAmount(1)).toBe(1)
  })

  it('rejects null/undefined/non-number', () => {
    expect(normalizeUnitAmount(null)).toBeNull()
    expect(normalizeUnitAmount(undefined)).toBeNull()
    // @ts-expect-error deliberately passing a string
    expect(normalizeUnitAmount('149')).toBeNull()
  })

  it('rejects zero and negatives (a $0 tier is never real revenue)', () => {
    expect(normalizeUnitAmount(0)).toBeNull()
    expect(normalizeUnitAmount(-100)).toBeNull()
  })

  it('rejects non-finite (NaN, Infinity)', () => {
    expect(normalizeUnitAmount(Number.NaN)).toBeNull()
    expect(normalizeUnitAmount(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('deriveAnnualDiscount', () => {
  it('canonical 20 %: monthly=149, yearly=1430 → 0.200', () => {
    // effective monthly = 1430/12 = 119.166… ; 1 - 119.166/149 ≈ 0.2003
    expect(deriveAnnualDiscount(149, 1430)).toBe(0.2)
  })

  it('canonical 20 % on pro (299 → 2870)', () => {
    expect(deriveAnnualDiscount(299, 2870)).toBe(0.2)
  })

  it('canonical 20 % on power (399 → 3830)', () => {
    expect(deriveAnnualDiscount(399, 3830)).toBe(0.2)
  })

  it('null yearly → null (caller preserves existing discount)', () => {
    expect(deriveAnnualDiscount(149, null)).toBeNull()
  })

  it('rounds to 3 decimals', () => {
    // 1 - (1000/12)/100 = 1 - 0.83333… = 0.16666… → 0.167
    expect(deriveAnnualDiscount(100, 1000)).toBe(0.167)
  })

  it('clamps to [0,1] — negative discount (yearly costs MORE than 12×monthly) → 0', () => {
    // 12 × 100 = 1200, yearly 1400 → raw = 1 - 116.66/100 = -0.166 → clamp 0
    expect(deriveAnnualDiscount(100, 1400)).toBe(0)
  })

  it('invalid monthly (0, negative, non-finite) → null', () => {
    expect(deriveAnnualDiscount(0, 1000)).toBeNull()
    expect(deriveAnnualDiscount(-100, 1000)).toBeNull()
    expect(deriveAnnualDiscount(Number.NaN, 1000)).toBeNull()
    expect(deriveAnnualDiscount(Number.POSITIVE_INFINITY, 1000)).toBeNull()
  })

  it('invalid yearly (0, negative, non-finite, when non-null) → null', () => {
    expect(deriveAnnualDiscount(149, 0)).toBeNull()
    expect(deriveAnnualDiscount(149, -100)).toBeNull()
    expect(deriveAnnualDiscount(149, Number.NaN)).toBeNull()
    expect(deriveAnnualDiscount(149, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('unit-agnostic: same result whether cents or dollars are passed', () => {
    // The helper cares about the ratio only, not the unit.
    expect(deriveAnnualDiscount(14900, 143000)).toBe(deriveAnnualDiscount(149, 1430))
  })
})
