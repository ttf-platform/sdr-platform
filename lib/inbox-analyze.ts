/**
 * lib/inbox-analyze.ts
 *
 * Shared sentiment analysis logic for inbox_messages.
 * Called by:
 *   - POST /api/inbox/messages/[id]/analyze (user-facing)
 *   - POST /api/webhooks/instantly          (fire-and-forget after reply ingestion)
 *   - POST /api/dev/simulate-reply/[id]     (dev fire-and-forget)
 *
 * Uses Claude Haiku for speed + cost. Returns after DB update.
 */

import { getAnthropicClient } from '@/lib/anthropic'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAiCall } from '@/lib/ai-cost'

export type SentimentLabel =
  | 'positive'
  | 'neutral'
  | 'negative'
  | 'meeting_request'
  | 'unsubscribe'
  | 'bounce'

const VALID_SENTIMENTS: SentimentLabel[] = [
  'positive', 'neutral', 'negative', 'meeting_request', 'unsubscribe', 'bounce',
]

function buildPrompt(message: {
  from_name: string | null
  from_email: string
  subject: string | null
  body: string | null
  original_subject?: string | null
  original_body?: string | null
}): string {
  const parts: string[] = [
    `Classify the sentiment of this email reply. Return JSON only — no markdown, no explanation.`,
    ``,
    `JSON schema: {"sentiment": "<label>", "confidence": <0.0-1.0>}`,
    ``,
    `Sentiment labels:`,
    `  positive        — prospect is interested, wants to learn more, positive tone`,
    `  meeting_request — prospect is asking for a call, demo, or meeting`,
    `  neutral         — informational reply, non-committal, polite but non-interested`,
    `  negative        — not interested, pushback, dismissive, rude`,
    `  unsubscribe     — asking to be removed from the list`,
    `  bounce          — delivery failure, out-of-office auto-reply, mailer daemon`,
    ``,
    `Reply from: ${message.from_name ? `${message.from_name} <${message.from_email}>` : message.from_email}`,
    `Subject: ${message.subject || '(no subject)'}`,
    `Body:`,
    message.body || '(empty)',
  ]

  if (message.original_subject) {
    parts.push(``, `Original email subject: ${message.original_subject}`)
  }

  return parts.join('\n')
}

interface AnalyzeResult {
  sentiment: SentimentLabel
  confidence: number
}

/**
 * Run sentiment analysis on an inbox_message and persist the result.
 * Does NOT throw — on any error it logs and returns null so callers can ignore.
 */
export async function analyzeMessageSentiment(
  messageId: string
): Promise<AnalyzeResult | null> {
  const admin = createAdminClient()

  const { data: message, error: fetchError } = await admin
    .from('inbox_messages')
    .select('id, from_name, from_email, subject, body, prospect_email_id')
    .eq('id', messageId)
    .single()

  if (fetchError || !message) {
    console.error('[inbox-analyze] message not found:', messageId, fetchError)
    return null
  }

  // Optionally load original email subject for context
  let originalSubject: string | null = null
  if (message.prospect_email_id) {
    const { data: orig } = await admin
      .from('prospect_emails')
      .select('subject')
      .eq('id', message.prospect_email_id)
      .single()
    originalSubject = orig?.subject ?? null
  }

  const prompt = buildPrompt({
    from_name: message.from_name,
    from_email: message.from_email,
    subject: message.subject,
    body: message.body,
    original_subject: originalSubject,
  })

  let sentiment: SentimentLabel = 'neutral'
  let confidence = 0.5

  try {
    const anthropic = getAnthropicClient()
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      messages: [{ role: 'user', content: prompt }],
    })
    // No cheap workspace_id resolution from a message id at this layer
    // (webhook fire-and-forget). Log with workspace_id=null and stash the
    // message_id in metadata for forensic joins if ever needed.
    void logAiCall({
      source:        'inbox_sentiment',
      workspace_id:  null,
      model:         'claude-haiku-4-5-20251001',
      input_tokens:  response.usage?.input_tokens  ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0,
      metadata:      { message_id: messageId },
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    const raw = start >= 0 && end >= 0 ? text.slice(start, end + 1) : ''

    const parsed = raw ? JSON.parse(raw) : {}

    if (VALID_SENTIMENTS.includes(parsed.sentiment)) {
      sentiment = parsed.sentiment
    }
    if (typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1) {
      confidence = parsed.confidence
    }
  } catch (err) {
    console.error('[inbox-analyze] Claude call failed:', err)
    return null
  }

  const { error: updateError } = await admin
    .from('inbox_messages')
    .update({ sentiment, sentiment_confidence: confidence })
    .eq('id', messageId)

  if (updateError) {
    console.error('[inbox-analyze] DB update failed:', updateError)
    return null
  }

  return { sentiment, confidence }
}
