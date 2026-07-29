import { describe, expect, it } from 'vitest'
import { TIMEZONES, canonicalizeIanaTz, resolveToListTimezone } from '../timezones'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// lib/timezones.ts decides what lands in booking_config.timezone at signup
// (signup/route.ts + workspace/create/route.ts resolve-to-list via
// `resolveToListTimezone` before UPDATE) AND drives the two <select>
// callers (dashboard/meetings, dashboard/settings). Its guarantees are
// what protects the two write paths from storing invalid IANA input ;
// its resolve-to-list contract is what keeps the DB and the <select>
// aligned even across an ICU version bump.
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

  it('resolves case and IANA link aliases to their Intl canonical name', () => {
    // These assertions still depend on IANA's tzdb LINK records (which are
    // long-standing and IANA does not remove them). ICU can differ on
    // WHICH spelling of a link-pair it renders as "canonical" — so we
    // deliberately do NOT assert on the Kolkata / Calcutta pair here ;
    // resolveToListTimezone tests below cover that pair without pinning
    // ICU output.
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
    // input and returns it unchanged. Write paths use resolveToListTimezone
    // (which returns the ICU canonical for out-of-list inputs — an offset
    // string is out-of-list, so it lands verbatim). The <select> guard
    // `!TIMEZONES.includes(current)` renders these as a first option so a
    // stored offset stays visible + savable — see meetings/page.tsx +
    // settings/page.tsx.
    expect(canonicalizeIanaTz('+05:30')).toBe('+05:30')
    // Punctuation normalisation for offsets.
    expect(canonicalizeIanaTz('+0530')).toBe('+05:30')
    // 'GMT' with no offset resolves to UTC.
    expect(canonicalizeIanaTz('GMT')).toBe('UTC')
  })
})

// ─── resolveToListTimezone — the invariants that actually matter ─────────
//
// The list-name storage strategy at lib/timezones.ts::resolveToListTimezone
// decouples what the DB stores from the runtime ICU version. The tests
// below assert the invariants the two write paths + the two <select>
// callers depend on, without pinning any specific ICU-rendered spelling.
// A Node / ICU bump that swaps 'Asia/Kolkata' ↔ 'Asia/Calcutta' as
// canonical MUST leave all of these green.
describe('resolveToListTimezone — list-name storage invariants', () => {
  it('returns null when the input is refused by Intl (garbage does not silently pass)', () => {
    expect(resolveToListTimezone('Foo/Bar', TIMEZONES)).toBeNull()
    expect(resolveToListTimezone('', TIMEZONES)).toBeNull()
    expect(resolveToListTimezone(null, TIMEZONES)).toBeNull()
    expect(resolveToListTimezone(undefined, TIMEZONES)).toBeNull()
  })

  it('canonical list entries resolve to themselves', () => {
    for (const tz of ['UTC', 'Europe/Paris', 'America/Toronto', 'Australia/Sydney']) {
      expect(resolveToListTimezone(tz, TIMEZONES)).toBe(tz)
    }
  })

  it('case + IANA link inputs converge on the list name (not the ICU-rendered form)', () => {
    // 'utc' → 'UTC' (list entry, wins over lowercase ICU rendering)
    expect(resolveToListTimezone('utc', TIMEZONES)).toBe('UTC')
    // 'US/Pacific' → 'America/Los_Angeles' (list entry)
    expect(resolveToListTimezone('US/Pacific', TIMEZONES)).toBe('America/Los_Angeles')
  })

  it("Kolkata / Calcutta : both spellings resolve to the SAME list entry, and it's the one in TIMEZONES", () => {
    // Whichever spelling ICU calls "canonical" this runtime, BOTH inputs
    // must resolve to a value that is a member of TIMEZONES — because
    // the write path stores that value and the <select> reads TIMEZONES.
    // If a future ICU flips the canonical direction, this test STAYS
    // green so long as both spellings land on the same list entry.
    const fromModern = resolveToListTimezone('Asia/Kolkata', TIMEZONES)
    const fromLink   = resolveToListTimezone('Asia/Calcutta', TIMEZONES)
    expect(fromModern).not.toBeNull()
    expect(fromLink).not.toBeNull()
    expect((TIMEZONES as ReadonlyArray<string>).includes(fromModern as string)).toBe(true)
    expect(fromModern).toBe(fromLink)
  })

  it("Argentina/Buenos_Aires : modern + short-form spellings converge on the list entry", () => {
    const fromModern = resolveToListTimezone('America/Argentina/Buenos_Aires', TIMEZONES)
    const fromShort  = resolveToListTimezone('America/Buenos_Aires', TIMEZONES)
    expect(fromModern).not.toBeNull()
    expect(fromShort).not.toBeNull()
    expect((TIMEZONES as ReadonlyArray<string>).includes(fromModern as string)).toBe(true)
    expect(fromModern).toBe(fromShort)
  })

  it('out-of-list inputs (valid IANA but not in TIMEZONES) fall through to the ICU canonical form', () => {
    // 'Cuba' is a valid IANA link — but 'America/Havana' is not in our
    // list. Contract : resolveToListTimezone returns the ICU-rendered
    // canonical form, and the <select> out-of-list guard renders it as an
    // extra <option>.
    const resolved = resolveToListTimezone('Cuba', TIMEZONES)
    expect(resolved).toBe('America/Havana')
    expect((TIMEZONES as ReadonlyArray<string>).includes('America/Havana')).toBe(false)
  })

  it('is idempotent — resolveToListTimezone(resolveToListTimezone(x)) === resolveToListTimezone(x)', () => {
    // Feed the output back in : must stabilise on the first pass. Guards
    // against a subtle regression where the resolver returns something
    // that would map to a different value on a re-run.
    const samples = ['Asia/Kolkata', 'Asia/Calcutta', 'utc', 'UTC', 'US/Pacific', 'Europe/Paris', 'Cuba', 'America/Argentina/Buenos_Aires']
    for (const s of samples) {
      const first  = resolveToListTimezone(s, TIMEZONES)
      const second = resolveToListTimezone(first, TIMEZONES)
      expect(second).toBe(first)
    }
  })
})

// ─── TIMEZONES : pairwise-distinct physical zones ────────────────────────
//
// Two entries that collapsed to the same ICU-canonical form would mean
// resolveToListTimezone could return EITHER entry for an input matching
// that shared physical zone (first-wins via list order, but a re-order
// would silently flip which name the DB stores). This test guards
// against that class of regression : the 44 entries name 44 distinct
// physical zones on this runtime.
describe('TIMEZONES — no two entries name the same physical zone', () => {
  it('canonical forms of all entries are pairwise distinct', () => {
    const canonicals = TIMEZONES.map((tz) => canonicalizeIanaTz(tz))
    // First : none should be null (every entry MUST be Intl-acceptable).
    for (let i = 0; i < TIMEZONES.length; i++) {
      expect(canonicals[i], `entry ${TIMEZONES[i]} was rejected by Intl`).not.toBeNull()
    }
    // Then : dedup by canonical form and check size matches.
    const uniq = new Set(canonicals.filter((c): c is string => c !== null))
    expect(uniq.size).toBe(TIMEZONES.length)
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

  it('every entry has the expected IANA shape (Continent/Region[/SubRegion] or UTC)', () => {
    for (const tz of TIMEZONES) {
      // Allow optional /SubRegion segment to cover America/Argentina/Buenos_Aires.
      expect(tz).toMatch(/^([A-Z][a-zA-Z_]*(\/[A-Z][a-zA-Z_]*){1,2}|UTC)$/)
    }
  })

  it('includes UTC (the neutral fallback per book/[slug]/route.ts:79)', () => {
    expect((TIMEZONES as ReadonlyArray<string>).includes('UTC')).toBe(true)
  })
})
