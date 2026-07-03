import { z } from 'zod'

// PATCH /api/onboarding/progress body.
// All fields optional individually; the .refine guarantees the caller sent
// at least one — matches the route's previous behaviour where an empty
// payload returned 400 "No valid fields to update".
export const onboardingProgressPatchSchema = z.object({
  welcome_dismissed:             z.boolean().optional(),
  welcome_dismissed_permanently: z.boolean().optional(),
  checklist_dismissed:           z.boolean().optional(),
  try_mirvo_mode:                z.boolean().optional(),
  last_campaign_id:              z.string().uuid().nullable().optional(),
}).strict().refine(
  (obj) => Object.keys(obj).length > 0,
  'No valid fields to update',
)
