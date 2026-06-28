import { z } from 'zod'

export const prospectEmailUpdateSchema = z.object({
  subject: z.string().min(1).max(500).optional(),
  body:    z.string().max(50000).optional(),
}).strict().refine(
  obj => obj.subject !== undefined || obj.body !== undefined,
  'At least one of subject or body is required',
)

// POST /api/prospect-emails/[id]/regenerate body.
// mode is optional — falls back to campaign.personalization_mode → draft.mode → 'fast'.
export const prospectEmailRegenerateSchema = z.object({
  mode: z.enum(['fast', 'smart']).optional(),
}).strict()
