import { z } from 'zod'

const isValidIanaTz = (tz: string) => {
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

const ianaSchema = z.string().min(1).max(100).refine(isValidIanaTz, 'invalid_timezone')

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
