import { z } from 'zod'

const MEETING_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const

// meeting_at is a naive local datetime "YYYY-MM-DDTHH:MM" — converted to UTC server-side via workspace TZ
const naiveDatetime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)

export const meetingCreateSchema = z.object({
  title:          z.string().min(1).max(200),
  meeting_at:     naiveDatetime,
  duration_min:   z.number().int().positive().max(480).optional(),
  attendee_email: z.string().email().max(254),
  attendee_name:  z.string().max(200).optional(),
  company_name:   z.string().max(200).optional(),
  notes:          z.string().max(5000).optional(),
  prospect_id:    z.string().uuid().optional(),
}).strict()

export const meetingUpdateSchema = z.object({
  title:          z.string().min(1).max(200).optional(),
  meeting_at:     naiveDatetime.optional(),
  duration_min:   z.number().int().positive().max(480).optional(),
  attendee_email: z.string().email().max(254).optional(),
  attendee_name:  z.string().max(200).nullish(),
  company_name:   z.string().max(200).nullish(),
  status:         z.enum(MEETING_STATUSES).optional(),
  notes:          z.string().max(5000).nullish(),
}).strict().refine(obj => Object.keys(obj).length > 0, 'At least one field required')
