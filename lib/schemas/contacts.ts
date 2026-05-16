import { z } from 'zod'

export const contactUpdateSchema = z.object({
  first_name:   z.string().min(1).max(200).optional(),
  last_name:    z.string().min(1).max(200).optional(),
  company:      z.string().max(200).nullish(),
  title:        z.string().max(200).nullish(),
  linkedin_url: z.string().max(500).nullish(),
  website:      z.string().max(500).nullish(),
}).strict().refine(obj => Object.keys(obj).length > 0, 'At least one field required')
