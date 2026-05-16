import { z } from 'zod'

const ESCALATE_REASONS = [
  'user_request', 'critical_bug', 'billing', 'legal',
  'repeated_failure', 'negative_sentiment', 'tool_failure', 'other',
] as const

export const botMessageSchema = z.object({
  message:        z.string().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
}).strict()

export const botEscalateSchema = z.object({
  conversationId: z.string().uuid(),
  reason:         z.enum(ESCALATE_REASONS),
  summary:        z.string().max(500).optional(),
}).strict()
