import { z } from 'zod'

// ============================================================================
// Signal create payload
// ============================================================================
export const signalCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  source_type: z.enum(['template', 'custom']),
  template_id: z.enum(['hiring_role', 'recent_funding', 'tech_stack_change']).optional(),
  prompt_natural_language: z.string().max(2000).optional(),
  monitoring_config: z.record(z.unknown()).default({}),
  is_active: z.boolean().default(true),
}).refine(
  (data) => {
    if (data.source_type === 'template' && !data.template_id) return false
    if (data.source_type === 'custom' && !data.prompt_natural_language) return false
    return true
  },
  {
    message: 'template_id required if source_type=template, prompt_natural_language required if source_type=custom',
  }
)

// ============================================================================
// Signal update payload
// ============================================================================
export const signalUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  is_active: z.boolean().optional(),
  monitoring_config: z.record(z.unknown()).optional(),
}).strict()

// ============================================================================
// Signals list query params
// ============================================================================
export const signalsListQuerySchema = z.object({
  is_active: z.enum(['true', 'false']).optional().transform(v => v === undefined ? undefined : v === 'true'),
  source_type: z.enum(['template', 'custom']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

// ============================================================================
// Build prompt from plain English description
// ============================================================================
export const buildPromptSchema = z.object({
  description: z.string().min(20).max(2000),
})
