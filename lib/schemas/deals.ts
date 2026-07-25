import { z } from 'zod'

const DEAL_STAGES = [
  'new_lead', 'contacted', 'opened', 'replied', 'interested',
  'meeting_booked', 'proposal_sent', 'closed_won', 'closed_lost',
] as const

const CLOSED_REASONS = [
  'not_interested', 'no_budget', 'bad_timing', 'lost_to_competitor', 'other',
] as const

export const dealCreateSchema = z.object({
  contact_id: z.string().uuid(),
  stage:      z.enum(DEAL_STAGES).optional(),
  // .nullish() (aligned with dealUpdateSchema below): the AddLead modal
  // sends `amount: amount ? parseFloat(amount) : null` — an empty amount
  // field posts `null`, which .optional() alone would reject as
  // "Invalid payload". The route already collapses null via `amount ?? null`.
  amount:     z.number().nonnegative().nullish(),
  notes:      z.string().max(5000).optional(),
}).strict()

export const dealUpdateSchema = z.object({
  stage:           z.enum(DEAL_STAGES).optional(),
  amount:          z.number().nonnegative().nullish(),
  closed_reason:   z.enum(CLOSED_REASONS).nullish(),
  notes:           z.string().max(5000).nullish(),
  manual_override: z.boolean().optional(),
}).strict().refine(obj => Object.keys(obj).length > 0, 'At least one field required')
