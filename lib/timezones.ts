/**
 * Shared IANA timezone list + helpers.
 *
 * Consumed by :
 *   - app/(dashboard)/dashboard/meetings/page.tsx     (Scheduler settings <select>)
 *   - app/(dashboard)/dashboard/settings/page.tsx     (Company timezone <select>)
 *   - app/api/auth/signup/route.ts                   (resolve to list before write)
 *   - app/api/workspace/create/route.ts              (recovery / onboarding path)
 *   - app/[locale]/(auth)/signup/page.tsx            (client-side detection)
 *
 * WHY A STATIC LIST — NOT Intl.supportedValuesOf('timeZone') :
 *   Intl.supportedValuesOf lives in ES2022. The repo tsconfig currently
 *   targets `lib: ["dom","dom.iterable","es6"]`. Widening the lib target
 *   across the whole repo inside a signup-scoped PR is not a call this
 *   change makes. If a later PR wants dynamic listing, that decision goes
 *   with a measured tsc pass and its own review.
 *
 * WHY EXPANDED (vs the previous 13 entries in meetings/settings) :
 *   The pre-PR list held 6 US/CA zones + 3 European + 2 East-Asian + Sydney
 *   + UTC = 13. Every other continent's user landed on the fallback list,
 *   so a Madrid / São Paulo / Delhi / Lagos / Mexico visitor whose browser
 *   reported their actual zone would see it silently overwritten to
 *   America/Toronto on save. This list adds the top zones-by-population
 *   the platform is likely to receive : Iberia, Nordic-adjacent, LATAM,
 *   MENA, Africa, South & SE Asia, plus the previously-missing NZ/Perth.
 *   The invariant : if a stored / detected zone is NOT in this list, UI
 *   MUST keep it selected and display it verbatim (never replace with the
 *   first item). See TimezoneSelect callers for the enforcement.
 */

// The list carries MODERN IANA names — the spellings a user reads in the
// <select> and the ones we want to persist. 'Asia/Kolkata' (post-2013 IANA
// rename) and 'America/Argentina/Buenos_Aires' (post-2000 sub-zone form)
// are the current canonical IANA names ; older short forms ('Asia/Calcutta',
// 'America/Buenos_Aires') remain as IANA link aliases only.
//
// STORAGE INVARIANT (see resolveToListTimezone below) : we NEVER persist
// the ICU-rendered canonical form. We persist THE LIST NAME (the exact
// string shown in the <select>) when the input canonicalises to the same
// zone as a list entry. This decouples what lands in the DB from the
// runtime ICU version : both sides of the "same zone?" comparison are
// computed against the same Intl at write time, so a Node / ICU bump that
// swaps which spelling ICU calls "canonical" does not change what the DB
// stores. The user sees, and the DB holds, the same string.
//
// For out-of-list zones (not in TIMEZONES on either side of the compare),
// resolveToListTimezone falls back to the ICU-rendered canonical form and
// the <select>'s out-of-list guard prepends it as an extra <option> so it
// stays visible + savable.
export const TIMEZONES = [
  // Americas — north to south
  'America/Los_Angeles', 'America/Vancouver', 'America/Denver', 'America/Chicago',
  'America/New_York',    'America/Toronto',   'America/Halifax',
  'America/Mexico_City', 'America/Bogota',    'America/Lima',
  'America/Santiago',    'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
  // Europe — west to east
  'Europe/Lisbon',    'Europe/Dublin',   'Europe/London',
  'Europe/Madrid',    'Europe/Paris',    'Europe/Amsterdam',
  'Europe/Brussels',  'Europe/Zurich',   'Europe/Berlin',
  'Europe/Rome',      'Europe/Warsaw',   'Europe/Athens',
  'Europe/Istanbul',  'Europe/Moscow',
  // Africa
  'Africa/Casablanca', 'Africa/Lagos', 'Africa/Johannesburg',
  // Middle East
  'Asia/Jerusalem', 'Asia/Dubai',
  // South + SE Asia
  'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Jakarta',
  // East Asia
  'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Seoul', 'Asia/Tokyo',
  // Oceania
  'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland',
  // Neutral
  'UTC',
] as const

export type KnownTimezone = typeof TIMEZONES[number]

/**
 * Normalise an IANA-shaped input to the canonical zone name via Intl.
 * Returns null when Intl refuses the input outright ; otherwise returns
 * whatever `.resolvedOptions().timeZone` yields on this runtime.
 *
 * WHAT IT DOES : resolves aliases + case ('utc' → 'UTC', 'US/Pacific' →
 *   'America/Los_Angeles', 'Cuba' → 'America/Havana', and — depending on
 *   the ICU version — either 'Asia/Kolkata' or 'Asia/Calcutta' rendered as
 *   the "canonical" of that pair).
 *
 * WHAT IT DOES NOT DO : force a canonical IANA name. Offset strings like
 *   '+05:30' or '+0530' pass Intl AND come back UNCHANGED (well, '+0530'
 *   → '+05:30' — punctuation normalised). 'GMT' comes back as 'UTC'.
 *   Callers that need a canonical IANA zone name specifically must check
 *   the return against a known set — this helper only guards against
 *   Intl-refused garbage.
 *
 * Which spelling of a link-pair ICU calls "canonical" is ICU-version-
 * dependent (Node 24.15 / ICU 78.2 renders 'Asia/Calcutta' as canonical
 * for the Kolkata/Calcutta pair ; a future ICU could swap this back).
 * This is exactly why write paths use resolveToListTimezone below instead
 * of storing the raw output of this function.
 */
export function canonicalizeIanaTz(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') return null
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: input }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

// Memoised at module init : for each list entry, its ICU-rendered canonical
// form on the current runtime. Rebuilt once per process, then read O(1) per
// write. Order preserved so the first matching list entry wins when two
// entries would canonicalise to the same zone (which the pairwise-distinct
// test in lib/__tests__/timezones.test.ts asserts they don't — this is a
// defence in depth against a future ICU regression that would silently
// collapse two entries onto the same physical zone).
const LIST_CANONICALS: ReadonlyArray<readonly [string, string | null]> =
  TIMEZONES.map((entry) => [entry, canonicalizeIanaTz(entry)] as const)

/**
 * Resolve an input timezone to the exact string held in `list` — the
 * spelling the user sees in the <select> — when the input names the same
 * physical zone as one of the entries. Otherwise return the ICU-rendered
 * canonical form (or null if Intl refuses the input outright).
 *
 * WHY : the storage layer must output the LIST NAME (visible to the user
 * in <select>) rather than the ICU-canonical form, so a Node / ICU bump
 * that swaps which spelling ICU calls "canonical" for a link-pair (e.g.
 * Kolkata ↔ Calcutta) does NOT change what the DB stores. Both sides of
 * the comparison are canonicalised through the SAME Intl at write time,
 * so they move together.
 *
 * Behaviour :
 *   resolveToListTimezone('Asia/Kolkata',  TIMEZONES) → 'Asia/Kolkata'
 *   resolveToListTimezone('Asia/Calcutta', TIMEZONES) → 'Asia/Kolkata'
 *   resolveToListTimezone('UTC',           TIMEZONES) → 'UTC'
 *   resolveToListTimezone('US/Pacific',    TIMEZONES) → 'America/Los_Angeles'
 *   resolveToListTimezone('Cuba',          TIMEZONES) → 'America/Havana'    (canonical, not in list)
 *   resolveToListTimezone('Foo/Bar',       TIMEZONES) → null                 (Intl refuses)
 *
 * The out-of-list case ('Cuba' above) returns the ICU canonical form —
 * the <select> guard `!TIMEZONES.includes(current)` prepends it as an
 * extra <option> so a rare zone stays visible + savable ; see
 * meetings/page.tsx + settings/page.tsx callers.
 *
 * Uses the memoised LIST_CANONICALS map when `list === TIMEZONES` (the
 * common case) ; falls back to per-call canonicalisation of `list` when a
 * caller passes a custom list (currently none — signature kept explicit
 * for readability at call sites).
 */
export function resolveToListTimezone(
  input: string | null | undefined,
  list: ReadonlyArray<string>,
): string | null {
  const canonical = canonicalizeIanaTz(input)
  if (canonical === null) return null
  const useMemo = list === (TIMEZONES as unknown as ReadonlyArray<string>)
  if (useMemo) {
    for (const [entry, entryCanonical] of LIST_CANONICALS) {
      if (entryCanonical !== null && entryCanonical === canonical) return entry
    }
    return canonical
  }
  for (const entry of list) {
    const entryCanonical = canonicalizeIanaTz(entry)
    if (entryCanonical !== null && entryCanonical === canonical) return entry
  }
  return canonical
}

/**
 * Client-side detection with SSR + Intl-missing guard. Matches the pattern
 * already used at app/[locale]/book/[slug]/page.tsx:122-124 and
 * app/[locale]/book/confirm/[token]/page.tsx:116.
 *
 * Falls back to 'UTC' — a neutral zone that never silently displaces the
 * user into someone else's local time.
 */
export function detectClientTimezone(): string {
  if (typeof Intl === 'undefined') return 'UTC'
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
