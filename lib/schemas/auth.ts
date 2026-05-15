import { z } from 'zod'

export const signupSchema = z.object({
  email:         z.string().email().max(254),
  password:      z.string().min(8).max(72),
  name:          z.string().min(1).max(100),
  workspaceName: z.string().min(1).max(100),
  companyName:   z.string().max(200).optional(),
  product:       z.string().max(2000).optional(),
  icp:           z.string().max(5000).optional(),
  tone:          z.string().max(50).optional(),
  plan_tier:     z.enum(['starter', 'pro', 'power']).optional(),
})

export const loginSchema = z.object({
  email:    z.string().email().max(254),
  password: z.string().min(1).max(72),
})
