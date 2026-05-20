import { z } from 'zod'

// Prospect import: outer envelope only. Inner `data` structure varies by mode
// and is validated by the route handler (mode-specific logic preserved).
export const prospectImportSchema = z.object({
  mode:        z.enum(['manual', 'paste', 'csv']),
  campaign_id: z.string().uuid().nullish(),
  data:        z.unknown(),
})

// Status values from migration 012 CHECK constraint.
export const PROSPECT_STATUSES = [
  'found', 'emailed', 'opened', 'replied', 'meeting', 'bounced', 'unsubscribed',
] as const

// PATCH /api/prospects/[id] — only status is patchable (PATCHABLE const in route).
export const prospectUpdateSchema = z.object({
  status: z.enum(PROSPECT_STATUSES).optional(),
})
