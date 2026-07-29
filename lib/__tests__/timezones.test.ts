import { describe, expect, it } from 'vitest'
import { TIMEZONES, canonicalizeIanaTz } from '../timezones'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// lib/timezones.ts decides what lands in booking_config.timezone at signup
// (signup/route.ts canonicalises via `canonicalizeIanaTz` before UPDATE)
// AND drives the two <select> callers (dashboard/meetings, dashboard/
// settings). Its guarantees are what protects the two write paths from
// storing invalid IANA input ; its list-vs-canonical alignment is what
// keeps the <select> from silently double-listing the same physical zone.
//
// detectClientTimezone() is DELIBERATELY NOT covered here — mocking Intl
// under vitest without jsdom would produce a test of façade, not a test
// of behaviour. Its runtime is exercised by the two-branch guard
// `typeof Intl === 'undefined'` (SSR fallback) and the client-side signup
// flow (empirical proof lives in the sim runbook).

describe('canonicalizeIanaTz', () => {
  it('returns null on empty / null / undefined / non-string inputs', () => {
    expect(canonicalizeIanaTz('')).toBeNull()
    expect(canonicalizeIanaTz(null)).toBeNull()
    expect(canonicalizeIanaTz(undefined)).toBeNull()
    // Types are compile-time, but at runtime the client can send anything.
    expect(canonicalizeIanaTz(42 as unknown as string)).toBeNull()
    expect(canonicalizeIanaTz({} as unknown as string)).toBeNull()
  })

  it('passes canonical IANA names through unchanged', () => {
    for (const tz of ['UTC', 'Europe/Paris', 'America/Toronto', 'Australia/Sydney', 'Pacific/Auckland']) {
      expect(canonicalizeIanaTz(tz)).toBe(tz)
    }
  })

  it('resolves case and alias variants to their Intl canonical name', () => {
    expect(canonicalizeIanaTz('utc')).toBe('UTC')
    expect(canonicalizeIanaTz('US/Pacific')).toBe('America/Los_Angeles')
    expect(canonicalizeIanaTz('Cuba')).toBe('America/Havana')
  })

  it('returns null on inputs Intl rejects outright', () => {
    expect(canonicalizeIanaTz('Foo/Bar')).toBeNull()
    expect(canonicalizeIanaTz('GMT+2')).toBeNull()
    expect(canonicalizeIanaTz('Not/A/Zone')).toBeNull()
  })

  it('accepts offset strings — DOCUMENTED escape, NOT a canonical IANA name', () => {
    // This is a hazard the isValidIanaTz + canonicalizeIanaTz pair does
    // NOT close on its own : Intl accepts `+05:30` as a valid timezone
    // input and returns it unchanged. Storage callers that need a strict
    // IANA name (as opposed to any Intl-acceptable string) must check
    // membership against a known set. The <select> guard `!TIMEZONES.
    // includes(current)` renders these as a first option so a stored
    // offset stays visible + savable — see meetings/page.tsx +
    // settings/page.tsx.
    expect(canonicalizeIanaTz('+05:30')).toBe('+05:30')
    // Punctuation normalisation for offsets.
    expect(canonicalizeIanaTz('+0530')).toBe('+05:30')
    // 'GMT' with no offset resolves to UTC.
    expect(canonicalizeIanaTz('GMT')).toBe('UTC')
  })
})

// ─── C3 pin — TIMEZONES entries must equal their Intl canonical form ─────
//
// If Intl's canonicalisation changes across a Node / ICU bump AND one of
// our entries stops matching its own canonical form, this test fails and
// the list must be re-canonicalised in the SAME PR that bumps the runtime.
// Without this pin, the write paths (signup canonicalises server-side)
// would silently drift out of alignment with the <select> options
// (dashboard/meetings + dashboard/settings) : a stored 'Asia/Calcutta'
// with 'Asia/Kolkata' in the list means the out-of-list guard prepends
// the stored form as an extra <option> — two labels for the same physical
// zone, per user.
describe('TIMEZONES — every entry is its own Intl canonical form', () => {
  it.each(TIMEZONES)('%s === canonicalizeIanaTz(itself)', (tz) => {
    expect(canonicalizeIanaTz(tz)).toBe(tz)
  })
})

// ─── Shape sanity ────────────────────────────────────────────────────────
//
// Regression guard for the write paths + <select> callers : an empty list
// or a duplicate entry would silently break dedup at the render layer.
describe('TIMEZONES — shape sanity', () => {
  it('has no duplicates', () => {
    const seen = new Set(TIMEZONES)
    expect(seen.size).toBe(TIMEZONES.length)
  })

  it('is not empty', () => {
    expect(TIMEZONES.length).toBeGreaterThan(0)
  })

  it('every entry has the expected IANA shape (Continent/Region… or UTC)', () => {
    for (const tz of TIMEZONES) {
      expect(tz).toMatch(/^([A-Z][a-zA-Z_]*\/[A-Z][a-zA-Z_]*|UTC)$/)
    }
  })

  it('includes UTC (the neutral fallback per book/[slug]/route.ts:79)', () => {
    expect((TIMEZONES as ReadonlyArray<string>).includes('UTC')).toBe(true)
  })
})
