import { z } from 'zod'

// Exported so signupSchema (lib/schemas/auth.ts) + workspaceCreateSchema
// (lib/schemas/workspace.ts) can reuse the same IANA validator instead of
// reimplementing it.
//
// Measured under Node 24.15 (ICU 78.2) — see lib/__tests__/timezones.test.ts :
//   Accepts (IANA canonical)     : 'UTC', 'Europe/Paris', 'America/Toronto'
//   Accepts (link/alias resolved
//     by Intl)                   : 'utc' → 'UTC', 'US/Pacific' → 'America/Los_Angeles',
//                                  'Cuba' → 'America/Havana'. The Kolkata /
//                                  Calcutta pair collapses to one of the two
//                                  spellings depending on ICU version — do
//                                  NOT hard-code either as "the" canonical.
//   Accepts (offset strings — NOT
//     canonical IANA zone names) : '+05:30', '+0530' → '+05:30', 'GMT' → 'UTC'
//   Rejects                       : 'Foo/Bar', 'GMT+2', ''
//
// IMPORTANT — what this validator does NOT guarantee :
//   (a) The stored value matches an IANA CANONICAL name. Offset strings
//       ('+05:30') pass this validator AND survive
//       lib/timezones.canonicalizeIanaTz, so they'd land in
//       booking_config.timezone as an offset if written raw. UI <select>
//       callers guard for out-of-list values ; see TIMEZONES consumers.
//   (b) That the two workspace-timezone write paths land the same string
//       for the same physical zone. The signup route + workspace/create
//       route use lib/timezones.resolveToListTimezone, which returns the
//       LIST NAME (the spelling from TIMEZONES the user sees in
//       <select>) whenever the input matches a list entry. POST
//       /api/workspace/profile:36-42 (real merge) and PUT
//       /api/workspace-profile (replacement) forward the raw <select>
//       value — which is ALREADY a list name because the <select>'s
//       options come from the same TIMEZONES constant. Net effect : all
//       four in-list paths converge on the exact same string, regardless
//       of the ICU version rendering "canonical" one way or the other.
//   (c) The canonical form is stable across runtimes. Intl canonical
//       resolution depends on ICU version — a Node upgrade or a browser
//       change could swap which spelling of a link-pair ICU calls
//       canonical. The list-name storage strategy at
//       lib/timezones.resolveToListTimezone insulates the DB from that
//       drift ; the tests in lib/__tests__/timezones.test.ts assert the
//       resolve-to-list invariants without pinning a specific ICU output.
export const isValidIanaTz = (tz: string) => {
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true }
  catch { return false }
}

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine(s => {
    const parsed = Date.parse(s)
    if (isNaN(parsed)) return false
    return new Date(parsed).toISOString().startsWith(s.slice(0, 10))
  }, 'invalid_date_value')

export const ianaSchema = z.string().min(1).max(100).refine(isValidIanaTz, 'invalid_timezone')

export const bookingCreateSchema = z.object({
  date:               dateSchema,
  time:               z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:MM'),
  prospect_timezone:  ianaSchema,
  duration_min:       z.number().int().positive().max(480),
  attendee_email:     z.string().email().max(254),
  attendee_name:      z.string().max(200).optional(),
  company_name:       z.string().max(200).optional(),
  notes:              z.string().max(5000).optional(),
}).strict()

export const bookingAvailabilitySchema = z.object({
  date:        dateSchema,
  prospect_tz: ianaSchema.optional(),
})
