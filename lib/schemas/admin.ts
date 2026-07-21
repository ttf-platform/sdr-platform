import { z } from 'zod'

export const adminBroadcastSchema = z.object({
  subject: z.string().min(1).max(500),
  body:    z.string().min(1).max(50000),
  target:  z.enum(['all', 'trial', 'paid']),
})

export const adminCreditsGrantSchema = z.object({
  email:  z.string().email(),
  amount: z.number().int().positive().max(100000),
  reason: z.string().min(3).max(500),
})

export const adminSettingsUpdateSchema = z.object({
  admin_notification_email:           z.string().email().or(z.literal('')).nullable().optional(),
  signups_enabled:                    z.boolean().optional(),
  maintenance_mode:                   z.boolean().optional(),
  widget_help_enabled:                z.boolean().optional(),
  bot_max_messages_per_hour_per_user: z.number().int().min(0).max(1000).optional(),
  // Admin alerts per event × channel (email / in-app). Missing events fall
  // back to registry defaults (lib/admin-alerts.ts). Enum kept in sync with
  // ADMIN_ALERT_EVENTS — adding a new event requires bumping both.
  admin_alert_prefs: z.record(
    z.enum([
      'new_signup',
      'new_subscription',
      'payment_succeeded',
      'payment_failed',
      'subscription_cancelled',
      'bug_report',
      'support_escalation',
      'health_alert',
    ]),
    z.object({ email: z.boolean(), in_app: z.boolean() }).strict(),
  ).optional(),
}).strict()

export const adminEscalationUpdateSchema = z.object({
  status:         z.enum(['pending', 'in_progress', 'resolved']).optional(),
  admin_response: z.string().max(5000).optional(),
})

export const adminBugReportUpdateSchema = z.object({
  status:      z.enum(['new', 'acknowledged', 'in_progress', 'resolved', 'closed']).optional(),
  priority:    z.enum(['low', 'medium', 'high', 'critical']).optional(),
  admin_notes: z.string().max(5000).optional(),
})

export const adminFeedbackUpdateSchema = z.object({
  status:      z.enum(['new', 'acknowledged', 'planned', 'shipped', 'declined']).optional(),
  admin_notes: z.string().max(5000).optional(),
})
