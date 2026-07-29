import { z } from 'zod'

// Exported so signupSchema (lib/schemas/auth.ts) + workspaceCreateSchema
// (lib/schemas/workspace.ts) can reuse the same IANA validator instead of
// reimplementing it.
//
// Measured under Node 24.15 (ICU 78.2) — see lib/__tests__/timezones.test.ts :
//   Accepts (IANA canonical)     : 'UTC', 'Europe/Paris', 'America/Toronto'
//   Accepts (link/alias resolved
//     by Intl)                   : 'utc' → 'UTC', 'US/Pacific' → 'America/Los_Angeles',
//                                  'Cuba' → 'America/Havana', 'Asia/Kolkata' → 'Asia/Calcutta'
//   Accepts (offset strings — NOT
//     canonical IANA zone names) : '+05:30', '+0530' → '+05:30', 'GMT' → 'UTC'
//   Rejects                       : 'Foo/Bar', 'GMT+2', ''
//
// IMPORTANT — what this validator does NOT guarantee :
//   (a) The stored value matches an IANA CANONICAL name. Offset strings
//       ('+05:30') pass this validator AND survive
//       lib/timezones.canonicalizeIanaTz, so they land in
//       booking_config.timezone as an offset. UI <select> callers guard
//       for out-of-list values ; see TIMEZONES consumers.
//   (b) The stored form matches the <select> form for the same physical
//       zone. The signup route canonicalises server-side ('Asia/Kolkata'
//       → 'Asia/Calcutta'). POST /api/workspace/profile:36-42 and
//       PUT /api/workspace-profile merge the raw <select> value ('Asia/
//       Kolkata') without canonicalisation. Same physical zone, two stored
//       spellings depending on the write path. Documented ; fixing this
//       touches both preexisting routes and is out of scope of the signup
//       PR that introduced this validator.
//   (c) The canonical form is stable across runtimes. Intl canonical
//       resolution depends on ICU version — a Node upgrade or a browser
//       change could swap 'Asia/Calcutta' back to 'Asia/Kolkata'. The
//       test in lib/__tests__/timezones.test.ts pins the current mapping
//       so a runtime bump surfaces as a test failure.
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
