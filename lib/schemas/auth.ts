import { z } from 'zod'

export const signupSchema = z.object({
  email:         z.string().email().max(254),
  password:      z.string().min(8).max(72),
  name:          z.string().min(1).max(100),
  companyName:   z.string().min(1).max(200),
  plan_tier:     z.enum(['starter', 'pro', 'power']).optional(),
  captchaToken:  z.string().min(1, 'captcha_required'),
})

export const loginSchema = z.object({
  email:    z.string().email().max(254),
  password: z.string().min(1).max(72),
})
