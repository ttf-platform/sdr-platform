/**
 * lib/instantly-webhook-mapping.ts
 *
 * Defensive mapping for inbound provider webhook payloads.
 *
 * Background: as of Sprint A4 we have ZERO real webhook deliveries to
 * inspect — no live mailbox is connected. The provider's documented event
 * names ("Reply Received", "Email Sent", "Email Bounced", …) and field
 * shapes have shifted between API v1, v2, and beta documentation, so we
 * cannot trust any single field name. This module tries every plausible
 * alias for each field and normalises event names to an internal enum so
 * the route can route on a stable surface.
 *
 * Every fallback is documented next to the field. When the first real
 * payload arrives, log the raw body, identify which alias matched, and
 * trim the fallbacks back to what the provider actually sends.
 */

// ---------------------------------------------------------------------------
// Event normalisation
// ---------------------------------------------------------------------------

export type NormalizedEvent =
  | 'REPLY'
  | 'SENT'
  | 'BOUNCED'
  | 'UNSUBSCRIBED'
  | 'ACCOUNT_ERROR'
  | 'UNKNOWN'

/** Normalise the event name across snake_case / dotted / Title Case variants. */
export function normalizeEvent(raw: unknown): NormalizedEvent {
  if (typeof raw !== 'string') return 'UNKNOWN'
  const key = raw.trim().toLowerCase().replace(/[\s\-]+/g, '_').replace(/\./g, '_')

  if (REPLY_ALIASES.has(key))         return 'REPLY'
  if (SENT_ALIASES.has(key))          return 'SENT'
  if (BOUNCED_ALIASES.has(key))       return 'BOUNCED'
  if (UNSUBSCRIBED_ALIASES.has(key))  return 'UNSUBSCRIBED'
  if (ACCOUNT_ERROR_ALIASES.has(key)) return 'ACCOUNT_ERROR'
  return 'UNKNOWN'
}

const REPLY_ALIASES = new Set([
  'reply_received', 'reply', 'email_replied', 'email_reply',
  'message_replied', 'lead_replied', 'inbound_reply',
])
const SENT_ALIASES = new Set([
  'email_sent', 'sent', 'message_sent', 'lead_sent', 'email_delivered',
])
const BOUNCED_ALIASES = new Set([
  'email_bounced', 'bounce', 'bounced', 'hard_bounce', 'soft_bounce',
  'delivery_failed', 'email_bounce',
])
const UNSUBSCRIBED_ALIASES = new Set([
  'lead_unsubscribed', 'unsubscribed', 'unsubscribe', 'opted_out', 'opt_out',
])
const ACCOUNT_ERROR_ALIASES = new Set([
  'email_account_error', 'account_error', 'mailbox_error',
  'eaccount_error', 'sending_error',
])

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

export interface ExtractedFields {
  /** Event id used for dedup. May be null if the provider doesn't send one
   *  on this event type — caller skips the dedup branch in that case. */
  eventId:           string | null
  /** Identifier of the message at the provider (e.g. SMTP Message-ID or lead id). */
  providerMessageId: string | null
  /** Instantly's UUID for the parent email row. Extracted strictly from
   *  data.email_id — the only identifier accepted by POST /api/v2/emails/reply
   *  as `reply_to_uuid`. Distinct from providerMessageId which is fuzzy across
   *  event types (Message-ID, lead_id, original_message_id, …). Null when the
   *  provider payload doesn't carry data.email_id (all non-REPLY events, and
   *  REPLY events emitted before the field lands — reply-from-inbox route
   *  must gate on this being non-null). */
  providerEmailUuid: string | null
  /** The prospect's email (the lead). */
  leadEmail:         string | null
  /** Free-text display name for the lead, if the provider includes one. */
  leadName:          string | null
  /** The user-side sending mailbox that received / sent this message. */
  inboxEmail:        string | null
  /** The provider's campaign id — used for workspace resolution fallback. */
  providerCampaignId: string | null
  /** Threading hint. We persist it on inbox_messages and match prospect_emails by it. */
  threadId:          string | null
  /** Subject of the reply / sent / bounced email. */
  subject:           string | null
  /** Body of the reply / sent / bounced email. */
  body:              string | null
  /** Free-text bounce reason from the provider (BOUNCED only, usually). */
  bounceReason:      string | null
}

type Bag = Record<string, unknown>

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim().length > 0) return v
  if (typeof v === 'number') return String(v)
  return null
}

function pick(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    const s = asString(c)
    if (s !== null) return s
  }
  return null
}

/**
 * Extract every field of interest by trying each documented + observed alias.
 * The payload is the `data` object inside the webhook envelope; the route
 * passes whatever shape the provider sends (envelope OR flat data) and we
 * fall back through both.
 */
export function extractFields(payload: unknown): ExtractedFields {
  const root = (payload && typeof payload === 'object' ? payload : {}) as Bag
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Bag
  const lead = (data.lead && typeof data.lead === 'object' ? data.lead : {}) as Bag

  return {
    // event id   — v2 docs say `id`; some payloads use event_id / message_id / uuid
    eventId: pick(
      data.id, data.event_id, data.uuid, data.event_uuid,
      data.message_id, data.delivery_id,
      root.id, root.event_id,
    ),
    // provider message id — sent path returns Message-ID; lead/sent variants
    // include lead_id; reply variants embed original_message_id
    providerMessageId: pick(
      data.message_id, data.email_id, data.lead_id,
      data.original_message_id, data.id,
      lead.id, lead.lead_id,
    ),
    // Instantly's email UUID — extracted ONLY from data.email_id. Feeds
    // POST /emails/reply.reply_to_uuid. Kept separate from the fuzzy
    // providerMessageId pick above so we never accidentally pass a
    // Message-ID string or a lead_id to the reply endpoint. Schema-assumed
    // until first real REPLY payload is inspected (dette D5): validate the
    // path is truly data.email_id when the first webhook lands.
    providerEmailUuid: typeof data.email_id === 'string' && data.email_id.length > 0
      ? data.email_id
      : null,
    // lead email — top-level alias varies wildly across event types
    leadEmail: pick(
      data.lead_email, data.email, data.from_email, data.reply_from,
      lead.email,
    ),
    leadName: pick(
      data.lead_name, data.from_name, data.first_name,
      lead.first_name ? [lead.first_name, lead.last_name].filter(Boolean).join(' ') : null,
      lead.name,
    ),
    // user mailbox — sometimes `inbox_email`, sometimes `eaccount` (Instantly term),
    // sometimes literal `to` / `from` depending on event direction
    inboxEmail: pick(
      data.inbox_email, data.eaccount, data.email_account,
      data.to_email, data.to, data.from,
    ),
    providerCampaignId: pick(
      data.campaign_id, data.campaign,
      lead.campaign_id,
    ),
    threadId: pick(
      data.thread_id, data.eaccount_thread_id, data.conversation_id,
      data.in_reply_to, data.references,
    ),
    subject: pick(
      data.reply_subject, data.subject, data.email_subject,
    ),
    body: pick(
      data.reply_body, data.body, data.reply_text, data.text,
      data.message, data.html_body, data.html,
    ),
    bounceReason: pick(
      data.bounce_reason, data.reason, data.error, data.failure_reason,
      data.diagnostic,
    ),
  }
}

// ---------------------------------------------------------------------------
// Helpers consumed by the route
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Cheap server-side email shape check. Provider should send valid addresses
 *  but we shouldn't INSERT garbage into inbox_messages.from_email which has
 *  a NOT NULL constraint. */
export function isPlausibleEmail(s: string | null): s is string {
  return s !== null && s.length <= 254 && EMAIL_REGEX.test(s)
}

/** Trim a free-text field to a safe DB length without truncating in the
 *  middle of a multibyte character oddly. */
export function clip(s: string | null, max: number): string | null {
  if (s === null) return null
  return s.length > max ? s.slice(0, max) : s
}
