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
  amount:     z.number().nonnegative().optional(),
  notes:      z.string().max(5000).optional(),
}).strict()

export const dealUpdateSchema = z.object({
  stage:           z.enum(DEAL_STAGES).optional(),
  amount:          z.number().nonnegative().nullish(),
  closed_reason:   z.enum(CLOSED_REASONS).nullish(),
  notes:           z.string().max(5000).nullish(),
  manual_override: z.boolean().optional(),
}).strict().refine(obj => Object.keys(obj).length > 0, 'At least one field required')
