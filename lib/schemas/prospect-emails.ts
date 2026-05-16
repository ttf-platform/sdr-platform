import { z } from 'zod'

export const prospectEmailUpdateSchema = z.object({
  subject: z.string().min(1).max(500).optional(),
  body:    z.string().max(50000).optional(),
}).strict().refine(
  obj => obj.subject !== undefined || obj.body !== undefined,
  'At least one of subject or body is required',
)
