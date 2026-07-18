import { describe, it, expect } from 'vitest'
import { getUsagePeriod, calendarMonthUtc } from '@/lib/billing-period'

describe('getUsagePeriod', () => {
  describe('paid subscription (both period columns populated)', () => {
    it('returns the Stripe-anchored window verbatim', () => {
      const ws = {
        current_period_start: '2026-01-29',
        current_period_end:   '2026-02-28',
      }
      expect(getUsagePeriod(ws, new Date('2026-02-10T12:00:00Z')))
        .toEqual({ start: '2026-01-29', end: '2026-02-28' })
    })

    it('is unaffected by the wall clock — start/end come from the workspace, not `now`', () => {
      const ws = {
        current_period_start: '2026-06-17',
        current_period_end:   '2026-07-17',
      }
      // Bogus `now` — different month, different year.
      expect(getUsagePeriod(ws, new Date('2029-12-31T23:59:59Z')))
        .toEqual({ start: '2026-06-17', end: '2026-07-17' })
    })

    it('handles year-crossing periods (Dec 29 → Jan 29)', () => {
      const ws = {
        current_period_start: '2025-12-29',
        current_period_end:   '2026-01-29',
      }
      expect(getUsagePeriod(ws, new Date('2026-01-05T00:00:00Z')))
        .toEqual({ start: '2025-12-29', end: '2026-01-29' })
    })
  })

  describe('trial / no-sub fallback (columns null)', () => {
    it('returns the calendar month in UTC when both columns are null', () => {
      const now = new Date('2026-01-17T15:00:00Z')
      expect(getUsagePeriod({ current_period_start: null, current_period_end: null }, now))
        .toEqual({ start: '2026-01-01', end: '2026-02-01' })
    })

    it('returns the calendar month when the workspace is null', () => {
      const now = new Date('2026-03-05T00:00:00Z')
      expect(getUsagePeriod(null, now))
        .toEqual({ start: '2026-03-01', end: '2026-04-01' })
    })

    it('returns the calendar month when the workspace is undefined', () => {
      const now = new Date('2026-11-30T23:00:00Z')
      expect(getUsagePeriod(undefined, now))
        .toEqual({ start: '2026-11-01', end: '2026-12-01' })
    })

    it('falls back when only start is set (bad state, treat as trial)', () => {
      const now = new Date('2026-05-01T00:00:00Z')
      expect(getUsagePeriod({ current_period_start: '2026-05-01', current_period_end: null }, now))
        .toEqual({ start: '2026-05-01', end: '2026-06-01' })
    })
  })

  describe('month-boundary safety (UTC-only, no off-by-one)', () => {
    it('midnight UTC on the 1st of the month lands on that month, not the previous one', () => {
      const now = new Date('2026-01-01T00:00:00Z')
      expect(getUsagePeriod(null, now))
        .toEqual({ start: '2026-01-01', end: '2026-02-01' })
    })

    it('one second before midnight UTC on the last day of the month stays inside that month', () => {
      const now = new Date('2026-01-31T23:59:59Z')
      expect(getUsagePeriod(null, now))
        .toEqual({ start: '2026-01-01', end: '2026-02-01' })
    })

    it('midnight UTC on the 1st of the year crosses correctly', () => {
      const now = new Date('2026-01-01T00:00:00Z')
      expect(calendarMonthUtc(now))
        .toEqual({ start: '2026-01-01', end: '2026-02-01' })
    })

    it('midnight UTC on Dec 31 rolls to Jan 1 next year for `end`', () => {
      const now = new Date('2026-12-31T00:00:00Z')
      expect(calendarMonthUtc(now))
        .toEqual({ start: '2026-12-01', end: '2027-01-01' })
    })

    it('february 28 (non-leap year) still lands on 2026-02-01 / 2026-03-01', () => {
      const now = new Date('2026-02-28T12:00:00Z')
      expect(calendarMonthUtc(now))
        .toEqual({ start: '2026-02-01', end: '2026-03-01' })
    })
  })

  describe('write↔read consistency', () => {
    it('reads and writes on the SAME workspace state produce the SAME start string', () => {
      const ws = { current_period_start: '2026-01-29', current_period_end: '2026-02-28' }
      const readPeriod  = getUsagePeriod(ws, new Date('2026-02-01T00:00:00Z'))
      const writePeriod = getUsagePeriod(ws, new Date('2026-02-10T00:00:00Z'))
      // Reads and writes anywhere in the paid window MUST use the same start.
      // Otherwise the counter aggregating across period_start values drifts.
      expect(readPeriod.start).toEqual(writePeriod.start)
      expect(readPeriod.end).toEqual(writePeriod.end)
    })

    it('trial fallback: reads and writes on the same day land on the same calendar-month start', () => {
      const readPeriod  = getUsagePeriod(null, new Date('2026-01-17T12:00:00Z'))
      const writePeriod = getUsagePeriod(null, new Date('2026-01-17T22:00:00Z'))
      expect(readPeriod.start).toEqual(writePeriod.start)
    })
  })
})
