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
  // Lot 5a Morning Brief. La regex reproduit EXACTEMENT la contrainte CHECK
  // workspace_profiles_morning_brief_time_half_hour (migration 090) : 48
  // valeurs légales. Sert à rendre un 400 propre au lieu d'un 500 avec un
  // message Postgres brut. La contrainte en base reste la source de vérité.
  // AUCUNE valeur par défaut — Zod injecte la valeur même clé absente ;
  // couplé au pattern de la route (écrit tout champ présent dans
  // parsed.data), une valeur par défaut à vrai activerait la fonctionnalité
  // à chaque sauvegarde de profil, depuis n'importe quel écran.
  morning_brief_enabled:  z.boolean().optional(),
  morning_brief_time:     z.string().regex(/^([01]\d|2[0-3]):(00|30)$/).optional(),
})

export const morningBriefGenerateSchema = z.object({
  workspace_id: z.string().uuid(),
})

export const workspaceBookingProfileSchema = z.object({
  booking_config: z.record(z.string(), z.unknown()).optional(),
  booking_slug:   z.string().min(1).max(100).optional(),
}).strict().refine(
  obj => obj.booking_config !== undefined || obj.booking_slug !== undefined,
  'At least one of booking_config or booking_slug is required',
)
