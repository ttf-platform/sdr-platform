import { NextResponse } from 'next/server'
import { z } from 'zod'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/anthropic'
import { checkAiRateLimit } from '@/lib/ratelimit'

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
  const sep = '\n'
  const prompt = [
    `Write a short reply to this email. ${toneInstruction} Move toward a next step.`,
    `From: ${message.from_name || message.from_email || ''}`,
    `Subject: ${message.subject || ''}`,
    `Message: ${message.body || ''}`,
    `Write only the email body, no subject line.`,
  ].join(sep)

  const client = getAnthropicClient()
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  })

  const draft = msg.content[0].type === 'text' ? msg.content[0].text : ''
  return NextResponse.json({ draft })
}
