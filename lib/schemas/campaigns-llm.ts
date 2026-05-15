import { z } from 'zod'

export const campaignSuggestSchema = z.object({
  campaign_name:  z.string().min(1).max(200),
  target_persona: z.string().max(500).optional(),
  angle:          z.string().max(1000).optional(),
}).strict()

export const campaignGenerateDraftsSchema = z.object({
  mode:                        z.enum(['fast', 'smart']),
  include_booking_link_initial: z.boolean().optional(),
}).strict()

export const campaignRegenerateDraftsSchema = z.object({
  mode:                        z.enum(['fast', 'smart']),
  confirm:                     z.literal(true),
  include_booking_link_initial: z.boolean().optional(),
}).strict()

export const campaignStepAiWriteSchema = z.object({
  tone:         z.string().max(50).optional(),
  instructions: z.string().max(2000).optional(),
}).strict()
