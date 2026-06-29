import { createAdminClient } from '@/lib/supabase/admin'

export type WebhookEventType =
  | 'reply'
  | 'sent'
  | 'bounced'
  | 'account_error'
  | 'unsubscribed'
  | 'unknown'

export type WebhookProcessingStatus = 'success' | 'error' | 'ignored'

/**
 * Inserts one row into `webhook_events`. Fire-and-forget: any insert error is
 * swallowed (logged to console). A webhook handler MUST NEVER fail because
 * its trace row failed to persist — same discipline as logCronRun /
 * logAdminAction.
 *
 * NOTE: this helper is NOT called for signature-failed requests. Following
 * the CRON_SECRET precedent, 401 responses are never logged (attacker-
 * controlled body, log-flooding risk).
 */
export async function logWebhookEvent(params: {
  provider:             string                              // 'instantly'
  event_type:           WebhookEventType
  provider_event_id?:   string | null
  workspace_id?:        string | null
  raw_payload:          Record<string, unknown>
  processing_status:    WebhookProcessingStatus
  error_message?:       string | null
  handler_duration_ms?: number | null
  received_at:          string
}): Promise<void> {
  try {
    await createAdminClient().from('webhook_events').insert({
      provider:            params.provider,
      event_type:          params.event_type,
      provider_event_id:   params.provider_event_id   ?? null,
      workspace_id:        params.workspace_id        ?? null,
      raw_payload:         params.raw_payload,
      processing_status:   params.processing_status,
      error_message:       params.error_message       ?? null,
      handler_duration_ms: params.handler_duration_ms ?? null,
      received_at:         params.received_at,
    })
  } catch (err) {
    console.error('[logWebhookEvent] failed:', err)
  }
}
