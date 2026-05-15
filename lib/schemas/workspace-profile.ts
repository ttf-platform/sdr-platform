import { z } from 'zod'

export const workspaceProfileUpdateSchema = z.object({
  company_name:           z.string().min(1).max(200).optional(),
  sender_name:            z.string().max(100).optional(),
  user_name:              z.string().max(100).optional(),
  product_description:    z.string().min(1).max(2000).optional(),
  icp_description:        z.string().max(5000).optional(),
  value_proposition:      z.string().max(2000).optional(),
  tone:                   z.string().max(50).optional(),
  icp_company_size:       z.string().max(100).optional(),
  icp_company_sizes:      z.unknown().optional(),
  icp_industries:         z.unknown().optional(),
  pain_points:            z.unknown().optional(),
  target_titles:          z.unknown().optional(),
  target_regions:         z.unknown().optional(),
  target_company_revenue: z.unknown().optional(),
  user_industry:          z.string().max(100).optional(),
  user_company_size:      z.string().max(100).optional(),
  user_title:             z.string().max(100).optional(),
  company_website:        z.string().max(200).optional(),
  email_signature:        z.string().max(1000).optional(),
  signature_in_initial:   z.boolean().optional(),
  signature_in_followups: z.boolean().optional(),
  workspace_timezone:     z.string().max(100).optional(),
})

export const morningBriefGenerateSchema = z.object({
  workspace_id: z.string().uuid(),
})
