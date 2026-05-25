import { z } from 'zod'

// ============================================================================
// Variant approve / reject / edit
// ============================================================================
export const variantUpdateSchema = z.object({
  action: z.enum(['approve', 'reject', 'edit']),
  edited_subject: z.string().min(1).max(200).optional(),
  edited_body: z.string().min(1).max(5000).optional(),
}).refine(
  (data) => {
    if (data.action === 'edit' && (!data.edited_subject || !data.edited_body)) return false
    return true
  },
  { message: 'edited_subject and edited_body required for action=edit' }
)
