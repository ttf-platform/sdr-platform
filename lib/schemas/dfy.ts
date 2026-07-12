import { z } from 'zod'

// Shared domain regex — same shape as the route-level DOMAIN_REGEX in
// app/api/email-accounts/route.ts, kept centralised here so the DFY discovery
// routes and the order route validate identically.
const DFY_DOMAIN_SCHEMA = z.string().min(3).max(253).regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'Invalid domain')

// POST /api/email-accounts/dfy-domains/check body.
// Bulk availability probe before placing an order. 1-10 domains per call.
export const dfyDomainsCheckRequestSchema = z.object({
  domains: z.array(DFY_DOMAIN_SCHEMA).min(1).max(10),
}).strict()

// One mailbox to be created under a domain.
// email_address_prefix is the local part (e.g. "sales" → sales@domain.com).
const dfyOrderAccountSchema = z.object({
  emailAddressPrefix: z.string().min(1).max(64).regex(/^[a-z0-9._-]+$/i, 'Invalid email prefix'),
  firstName:          z.string().min(1).max(100),
  lastName:           z.string().min(1).max(100),
}).strict()

// One domain to be ordered + its accounts + the public site it redirects to.
// forwardingDomain is required — the derived sending domain must not resolve
// to a parked page. The per-item refine blocks the trivial cycle where a
// domain redirects to itself.
const dfyOrderItemSchema = z.object({
  domain:           DFY_DOMAIN_SCHEMA,
  forwardingDomain: DFY_DOMAIN_SCHEMA,
  accounts:         z.array(dfyOrderAccountSchema).min(1).max(10),
}).strict().refine(
  (item) => item.forwardingDomain.toLowerCase() !== item.domain.toLowerCase(),
  { message: 'Redirect target must differ from the ordered domain', path: ['forwardingDomain'] },
)

// POST /api/email-accounts/dfy-order body.
//
// SAFETY: simulate is optional but DEFAULTS TO TRUE. If the field is missing
// from the request body, the route treats it as a quote — never a real order.
// A real order requires the client to explicitly send { simulate: false }.
// Cross-item refine: no item's forwardingDomain may equal another item's
// ordered domain (no intra-order cycle).
export const createDfyOrderRequestSchema = z.object({
  orderType: z.enum(['dfy', 'pre_warmed_up']),
  items:     z.array(dfyOrderItemSchema).min(1).max(10),
  simulate:  z.boolean().optional().default(true),
}).strict().refine(
  (data) => {
    const orderedDomains = new Set(data.items.map((it) => it.domain.toLowerCase()))
    return data.items.every((it) => !orderedDomains.has(it.forwardingDomain.toLowerCase()))
  },
  { message: 'Redirect target must not point at any domain in this order', path: ['items'] },
)

export type CreateDfyOrderRequest = z.infer<typeof createDfyOrderRequestSchema>
