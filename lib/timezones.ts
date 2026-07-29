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
 * Normalise an IANA-shaped input to the canonical zone name.
 * Returns null when the input is not accepted by Intl.
 *
 * Verified under Node 22 : 'utc' → 'UTC', 'Cuba' → 'America/Havana',
 * 'US/Pacific' → 'America/Los_Angeles', '+05:30' → null.
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
