/**
 * Shared IANA timezone list + helpers.
 *
 * Consumed by :
 *   - app/(dashboard)/dashboard/meetings/page.tsx     (Scheduler settings <select>)
 *   - app/(dashboard)/dashboard/settings/page.tsx     (Company timezone <select>)
 *   - app/api/auth/signup/route.ts                   (canonicalize before write)
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

// Every entry MUST equal `canonicalizeIanaTz(entry)` on the current runtime.
// If it doesn't, the signup route stores one name ('Asia/Calcutta') while
// the <select> renders another ('Asia/Kolkata'), and the out-of-list guard
// then prepends the stored form as an extra <option> — two labels for the
// same zone, per user. Enforced by lib/__tests__/timezones.test.ts. When
// the ICU version drifts and the mapping changes, that test fails and the
// list must be re-canonicalised in the same PR that bumps the runtime.
//
// Notable ICU-77-era canonicalisations we're pinned to :
//   'America/Buenos_Aires' — Intl resolves 'America/Argentina/Buenos_Aires'
//                            back to this shorter form.
//   'Asia/Calcutta'        — Intl still uses the pre-2013 IANA link ; the
//                            modern spelling 'Asia/Kolkata' resolves down
//                            to this.
export const TIMEZONES = [
  // Americas — north to south
  'America/Los_Angeles', 'America/Vancouver', 'America/Denver', 'America/Chicago',
  'America/New_York',    'America/Toronto',   'America/Halifax',
  'America/Mexico_City', 'America/Bogota',    'America/Lima',
  'America/Santiago',    'America/Sao_Paulo', 'America/Buenos_Aires',
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
  'Asia/Calcutta', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Jakarta',
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
 *   'America/Los_Angeles', 'Cuba' → 'America/Havana', 'Asia/Kolkata' →
 *   'Asia/Calcutta' under Node 24 ICU 78).
 *
 * WHAT IT DOES NOT DO : force a canonical IANA name. Offset strings like
 *   '+05:30' or '+0530' pass Intl AND come back UNCHANGED (well, '+0530'
 *   → '+05:30' — punctuation normalised). 'GMT' comes back as 'UTC'.
 *   Callers that need a canonical IANA zone name specifically must check
 *   the return against a known set — this helper only guards against
 *   Intl-refused garbage.
 *
 * Measured under Node 24.15 (ICU 78.2). The canonical mapping is ICU-
 * version-dependent : bumping the runtime can change which alias resolves
 * to which name (e.g. a future ICU could restore 'Asia/Kolkata' as the
 * canonical). Test coverage in lib/__tests__/timezones.test.ts pins the
 * current mapping so a runtime bump surfaces as a failure.
 */
export function canonicalizeIanaTz(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') return null
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: input }).resolvedOptions().timeZone
  } catch {
    return null
  }
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
