import { z } from 'zod'

// Shared optional fields for both create and update.
// target_* and company_* are jsonb arrays — validated as unknown to avoid
// rejecting valid array shapes the frontend may send.
const baseFields = {
  angle:                     z.string().max(2000).nullish(),
  value_prop:                z.string().max(2000).nullish(),
  cta:                       z.string().max(500).nullish(),
  target_persona:            z.string().max(2000).nullish(),
  proof_points:              z.string().max(500).nullish(),
  target_industry:           z.unknown().optional(),
  target_titles:             z.unknown().optional(),
  target_regions:            z.unknown().optional(),
  company_sizes:             z.unknown().optional(),
  company_revenue:           z.unknown().optional(),
  tone:                      z.string().max(50).nullish(),
  language:                  z.string().max(50).optional(),
  smart_stop_on_reply:       z.boolean().optional(),
  smart_stop_on_bounce:      z.boolean().optional(),
  booking_link_in_followups: z.boolean().optional(),
}

export const campaignCreateSchema = z.object({
  name: z.string().min(1).max(200),
  ...baseFields,
})

export const campaignUpdateSchema = z.object({
  name:                         z.string().min(1).max(200).optional(),
  ...baseFields,
  status:                       z.string().max(50).optional(),
  include_booking_link_initial: z.boolean().optional(),
})

// Sequence step PATCH (subject/body/delay_days/include_booking_link).
// delay_days is hard-capped at 90 to prevent absurd schedules and reject
// negative/float/non-numeric inputs that would otherwise surface as a 500.
export const campaignStepUpdateSchema = z.object({
  subject:              z.string().max(500).nullable().optional(),
  body:                 z.string().max(50000).optional(),
  delay_days:           z.number().int().min(0).max(90).optional(),
  include_booking_link: z.boolean().optional(),
}).strict()
