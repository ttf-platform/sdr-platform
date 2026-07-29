import { describe, expect, it } from 'vitest'
import { convertNaiveLocalToUtc } from '../meeting-tz'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// convertNaiveLocalToUtc is the SHARED helper both POST /api/meetings and
// PATCH /api/meetings/[id] use to turn a "YYYY-MM-DDTHH:MM" naïve local
// datetime into a true UTC ISO string via the workspace's booking_config
// timezone. Pre-extraction, PATCH silently wrote the input as-if-UTC while
// POST did the conversion — same string, two stored values depending on
// route. This test locks the CONTRACT so a future refactor that inlines
// again OR diverges the two conversions fails here.

describe('convertNaiveLocalToUtc — workspace-wall-time to UTC', () => {
  it("America/Toronto in July (EDT, GMT-04:00) : 14:00 wall → 18:00 UTC", () => {
    // EDT (summer) is UTC-04:00 : 14:00 local = 18:00Z. Compare instant-
    // level not string-level so a leading-zero difference doesn't flunk.
    const iso = convertNaiveLocalToUtc('2026-07-15T14:00', 'America/Toronto')
    expect(new Date(iso).getTime()).toBe(new Date('2026-07-15T18:00:00Z').getTime())
  })

  it("America/Toronto in January (EST, GMT-05:00) : 14:00 wall → 19:00 UTC (DST-safe)", () => {
    const iso = convertNaiveLocalToUtc('2026-01-15T14:00', 'America/Toronto')
    expect(new Date(iso).getTime()).toBe(new Date('2026-01-15T19:00:00Z').getTime())
  })

  it("Europe/Paris in July (CEST, GMT+02:00) : 14:00 wall → 12:00 UTC", () => {
    const iso = convertNaiveLocalToUtc('2026-07-15T14:00', 'Europe/Paris')
    expect(new Date(iso).getTime()).toBe(new Date('2026-07-15T12:00:00Z').getTime())
  })

  it("Asia/Kolkata (GMT+05:30, no DST) : 14:00 wall → 08:30 UTC — half-hour offset regression guard", () => {
    // India Standard Time is a fractional offset. The month-independent
    // conversion + the half-hour arithmetic are both easy to break with a
    // whole-hour-only implementation ; this case pins both.
    const iso = convertNaiveLocalToUtc('2026-07-15T14:00', 'Asia/Kolkata')
    expect(new Date(iso).getTime()).toBe(new Date('2026-07-15T08:30:00Z').getTime())
  })

  it("UTC input : 14:00 wall → 14:00Z (identity)", () => {
    const iso = convertNaiveLocalToUtc('2026-07-15T14:00', 'UTC')
    expect(new Date(iso).getTime()).toBe(new Date('2026-07-15T14:00:00Z').getTime())
  })

  it('missing / null workspace TZ : falls back to UTC — legacy workspace without booking_config.timezone', () => {
    // Signup + workspace/create write a canonical zone at creation post-PR-A,
    // so this branch should be extremely rare going forward. Still tested :
    // the "silent shift into Toronto" was the whole reason PR A shipped, and
    // this helper must NEVER re-introduce it.
    expect(convertNaiveLocalToUtc('2026-07-15T14:00', null).endsWith('Z')).toBe(true)
    expect(convertNaiveLocalToUtc('2026-07-15T14:00', undefined))
      .toBe(convertNaiveLocalToUtc('2026-07-15T14:00', 'UTC'))
  })
})
