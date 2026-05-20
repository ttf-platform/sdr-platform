import { z } from 'zod'

const PROSPECT_STATUSES = ['found', 'emailed', 'opened', 'replied', 'meeting', 'bounced', 'unsubscribed'] as const
const PROSPECT_SOURCES  = ['manual', 'paste', 'csv_import', 'ai_discover', 'ai_enrich'] as const
const EMAIL_STATUSES    = ['draft', 'edited', 'approved', 'sending', 'sent', 'failed', 'bounced', 'replied', 'rejected'] as const

// CSV string → validated array, optional (absent param → undefined)
function csvEnum<T extends string>(values: readonly [T, ...T[]]) {
  return z
    .string()
    .transform(s => s.split(',').map(v => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).max(10))
    .optional()
}

// CSV email addresses (required — used in emails-lookup mode)
const csvEmailArray = z
  .string()
  .transform(s => s.split(',').map(e => e.trim().toLowerCase()).filter(Boolean))
  .pipe(z.array(z.string().email()).max(200))

// CSV UUIDs (optional, defaults to empty array)
// Note: .transform(v => v ?? []) instead of .default([]) avoids Zod re-validating [] against z.string()
const csvUuidArray = z
  .string()
  .transform(s => s.split(',').map(v => v.trim()).filter(Boolean))
  .pipe(z.array(z.string().uuid()).max(500))
  .optional()
  .transform(v => v ?? [])

export const prospectsListQuerySchema = z.object({
  campaign_id: z.string().uuid().optional(),
  status:      csvEnum(PROSPECT_STATUSES),
  source:      csvEnum(PROSPECT_SOURCES),
  search:      z.string().max(200).optional(),
  sort:        z.enum(['newest', 'oldest']).optional(),
  page:        z.coerce.number().int().min(1).max(10000).optional().default(1),
  limit:       z.coerce.number().int().min(1).max(100).optional().default(50),
})

export const prospectsListByEmailsQuerySchema = z.object({
  emails:           csvEmailArray,
  exclude_campaign: z.string().uuid().optional(),
  campaign_id:      z.string().uuid().optional(),
})

export const prospectEmailsListQuerySchema = z.object({
  campaign_id: z.string().uuid(),
  step_order:  z
    .string()
    .transform(s => s.split(',').map(n => parseInt(n, 10)).filter(n => !isNaN(n)))
    .pipe(z.array(z.number().int().min(0)).max(50))
    .optional(),
  status:      csvEnum(EMAIL_STATUSES),
  search:      z.string().max(200).optional(),
  page:        z.coerce.number().int().min(1).max(10000).optional().default(1),
  limit:       z.coerce.number().int().min(1).max(100).optional().default(50),
})

export const contactsListQuerySchema = z.object({
  campaign_id: z.string().uuid().optional(),
  status:      csvEnum(PROSPECT_STATUSES),
  source:      csvEnum(PROSPECT_SOURCES),
  search:      z.string().max(200).optional(),
  sort:        z.enum(['newest', 'oldest', 'name', 'name_z']).optional(),
  page:        z.coerce.number().int().min(1).max(10000).optional().default(1),
  limit:       z.coerce.number().int().min(1).max(100).optional().default(50),
  tag_ids:     csvUuidArray,
})
