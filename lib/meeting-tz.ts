/**
 * Naive local datetime → true UTC ISO string, resolved through a workspace's
 * booking-config timezone.
 *
 * Extracted from app/api/meetings/route.ts::POST so that PATCH
 * (app/api/meetings/[id]/route.ts) applies the SAME conversion. Pre-
 * extraction, PATCH ran `.update(parsed.data)` on the raw string, which
 * wrote the input as-if-UTC (14:00 → 14:00Z) while POST correctly wrote
 * workspace-wall-time UTC (14:00 America/Toronto → 18:00Z / 19:00Z).
 * Two different stored values for the same user input, depending on which
 * route touched the row — proven in the N3 simulation on 2026-07-29.
 *
 * Not reachable via the current UI (the meetings page only PATCHes
 * `{status}`) — this is an armed foot-gun for the first PR that ships
 * meeting-time editing. That PR MUST route through here rather than
 * re-implement the conversion.
 *
 * IMPLEMENTATION NOTES :
 *   - Uses `Intl.DateTimeFormat({ timeZoneName: 'longOffset' })` to get
 *     the DST-safe offset for the target date (noon-UTC trick avoids the
 *     ambiguous fall-back hour). Same shape as the availability + public
 *     booking routes — do not diverge.
 *   - `tz` fallback is 'UTC'. When the workspace has no booking_config
 *     stored (legacy pre-PR-A account) we treat the input as UTC-naïve ;
 *     signup + workspace/create now write a canonical zone at creation
 *     (see PR A), so this branch should be extremely rare going forward.
 *   - Returns an ISO 8601 string — same shape as the pre-extraction inline
 *     code (`.toISOString()`).
 *   - No I/O : caller is responsible for reading booking_config.timezone
 *     before calling. Keeps this a pure function that's trivially testable.
 */
export function convertNaiveLocalToUtc(
  naiveLocal: string,           // 'YYYY-MM-DDTHH:MM' — validated upstream by naiveDatetime regex
  workspaceTimezone: string | null | undefined,
): string {
  const tz        = workspaceTimezone ?? 'UTC'
  const datePart  = naiveLocal.slice(0, 10)
  const tzParts   = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${datePart}T12:00:00Z`))
  const offsetRaw = tzParts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const tzMatch   = offsetRaw.match(/GMT([+-]\d{2}:\d{2})/)
  const tzOffset  = tzMatch ? tzMatch[1] : '+00:00'
  return new Date(`${naiveLocal}:00${tzOffset}`).toISOString()
}
