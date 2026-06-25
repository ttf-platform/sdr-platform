import { z } from 'zod'

// One mailbox to be created under a domain.
// email_address_prefix is the local part (e.g. "sales" → sales@domain.com).
const dfyOrderAccountSchema = z.object({
  emailAddressPrefix: z.string().min(1).max(64).regex(/^[a-z0-9._-]+$/i, 'Invalid email prefix'),
  firstName:          z.string().min(1).max(100),
  lastName:           z.string().min(1).max(100),
}).strict()

// One domain to be ordered + its accounts.
const dfyOrderItemSchema = z.object({
  domain:   z.string().min(3).max(253).regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'Invalid domain'),
  accounts: z.array(dfyOrderAccountSchema).min(1).max(10),
}).strict()

// POST /api/email-accounts/dfy-order body.
//
// SAFETY: simulate is optional but DEFAULTS TO TRUE. If the field is missing
// from the request body, the route treats it as a quote — never a real order.
// A real order requires the client to explicitly send { simulate: false }.
export const createDfyOrderRequestSchema = z.object({
  orderType: z.enum(['dfy', 'pre_warmed_up']),
  items:     z.array(dfyOrderItemSchema).min(1).max(10),
  simulate:  z.boolean().optional().default(true),
}).strict()

export type CreateDfyOrderRequest = z.infer<typeof createDfyOrderRequestSchema>
