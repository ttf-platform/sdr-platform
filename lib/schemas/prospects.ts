import { z } from 'zod'

const importContactFields = {
  first_name:   z.string().nullish(),
  last_name:    z.string().nullish(),
  company:      z.string().nullish(),
  title:        z.string().nullish(),
  linkedin_url: z.string().nullish(),
  website:      z.string().nullish(),
}

export const prospectImportSchema = z.discriminatedUnion('mode', [
  z.object({
    mode:        z.literal('manual'),
    campaign_id: z.string().uuid().nullish(),
    data:        z.object({ email: z.string(), ...importContactFields }),
  }),
  z.object({
    mode:        z.literal('paste'),
    campaign_id: z.string().uuid().nullish(),
    data:        z.object({ emails: z.array(z.string()) }),
  }),
  z.object({
    mode:        z.literal('csv'),
    campaign_id: z.string().uuid().nullish(),
    data:        z.object({ rows: z.array(z.object({ email: z.string(), ...importContactFields })) }),
  }),
])

// Status values from migration 012 CHECK constraint.
export const PROSPECT_STATUSES = [
  'found', 'emailed', 'opened', 'replied', 'meeting', 'bounced', 'unsubscribed',
] as const

// PATCH /api/prospects/[id] — only status is patchable (PATCHABLE const in route).
export const prospectUpdateSchema = z.object({
  status: z.enum(PROSPECT_STATUSES).optional(),
})
