import { z } from 'zod'

// First-touch acquisition record. Optional at the schema level (a signup
// with cookies rejected or empty localStorage sends nothing), but when
// present it is strictly shaped: known keys only, each capped at 200 chars
// (255 for referrer to accommodate long hostnames), unknown keys silently
// stripped by .strip(). The whole object is written verbatim into
// workspaces.acquisition (jsonb) at workspace creation; never overwritten.
export const acquisitionSchema = z.object({
  utm_source:   z.string().max(200).optional(),
  utm_medium:   z.string().max(200).optional(),
  utm_campaign: z.string().max(200).optional(),
  utm_term:     z.string().max(200).optional(),
  utm_content:  z.string().max(200).optional(),
  referrer:     z.string().max(255).optional(),
}).strip()

export const signupSchema = z.object({
  email:         z.string().email().max(254),
  password:      z.string().min(8).max(72),
  name:          z.string().min(1).max(100),
  companyName:   z.string().min(1).max(200),
  plan_tier:     z.enum(['starter', 'pro', 'power']).optional(),
  captchaToken:  z.string().min(1, 'captcha_required'),
  acquisition:   acquisitionSchema.optional(),
})

export const loginSchema = z.object({
  email:    z.string().email().max(254),
  password: z.string().min(1).max(72),
})
