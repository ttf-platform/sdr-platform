import { z } from 'zod'

// POST /api/email-accounts — provision a new mailbox.
// domain: presence + length only; the route applies its own DOMAIN_REGEX for format.
// emailAddress: Zod email() for basic format; route also checks @domain match.
export const emailAccountCreateSchema = z.object({
  domain:       z.string().min(1).max(253),
  emailAddress: z.string().email().max(254),
  senderName:   z.string().min(1).max(100),
})
