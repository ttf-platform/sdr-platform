import { NextResponse } from 'next/server'
import { z } from 'zod'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/anthropic'
import { checkAiRateLimit } from '@/lib/ratelimit'
import { HUMAN_VOICE_RULES } from '@/lib/ai-voice'
import { logAiCall } from '@/lib/ai-cost'

const TONE_INSTRUCTIONS: Record<string, string> = {
  professional: 'Be formal and professional.',
  casual: 'Be friendly and conversational.',
  short: 'Be very concise — 2-3 sentences max.',
}

const schema = z.object({
  message_id: z.string().uuid(),
  tone: z.enum(['professional', 'casual', 'short']).optional().default('professional'),
})

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const aiCheck = await checkAiRateLimit(guard.workspaceId)
  if (!aiCheck.allowed) {
    return NextResponse.json(
      { error: 'AI rate limit exceeded for this workspace. Try again in a moment.', remaining: aiCheck.remaining, retry_after_ms: aiCheck.resetMs },
      { status: 429, headers: { 'Retry-After': Math.ceil(aiCheck.resetMs / 1000).toString() } }
    )
  }

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.errors }, { status: 400 })
  }

  const { message_id, tone } = parsed.data
  const admin = createAdminClient()

  // Verify the message belongs to the authenticated user's workspace
  const { data: message, error } = await admin
    .from('inbox_messages')
    .select('id, from_name, from_email, subject, body, workspace_id')
    .eq('id', message_id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (error || !message) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  const toneInstruction = TONE_INSTRUCTIONS[tone] ?? TONE_INSTRUCTIONS.professional
  const prompt = `You are writing a short reply to an inbound email. ${toneInstruction} Move toward a next step.

${HUMAN_VOICE_RULES}

LANGUAGE: Reply in the same language as the received message below. Match the sender's register and formality. Do not switch languages mid-message.

ANTI-FABRICATION: Do not invent facts, numbers, commitments, dates, prices, names, or details that are not present in the thread below. If a piece of information would help but is missing, ask for it rather than fabricate it.

RECEIVED MESSAGE:
From: ${message.from_name || message.from_email || ''}
Subject: ${message.subject || ''}
Body:
${message.body || ''}

Write only the email body. No subject line, no preamble, no quotes around the reply.`

  const client = getAnthropicClient()
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    temperature: 0.7,
    messages: [{ role: 'user', content: prompt }],
  })
  void logAiCall({
    source:        'inbox_draft',
    workspace_id:  guard.workspaceId,
    model:         'claude-sonnet-4-6',
    input_tokens:  msg.usage?.input_tokens  ?? 0,
    output_tokens: msg.usage?.output_tokens ?? 0,
  })

  const draft = msg.content[0].type === 'text' ? msg.content[0].text : ''
  return NextResponse.json({ draft })
}
