import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { campaignStepAiWriteSchema, badRequest } from '@/lib/schemas'
import { getAnthropicClient } from '@/lib/anthropic'
import { checkAiRateLimit } from '@/lib/ratelimit'
import { HUMAN_VOICE_RULES, selfRevisionBlock, languageDirective } from '@/lib/ai-voice'

export async function POST(request: Request, context: { params: Promise<{ id: string; step_id: string }> }) {
  const params = await context.params
  const client = getAnthropicClient()
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const aiCheck = await checkAiRateLimit(guard.workspaceId)
  if (!aiCheck.allowed) {
    return NextResponse.json(
      { error: 'AI rate limit exceeded for this workspace. Try again in a moment.', remaining: aiCheck.remaining, retry_after_ms: aiCheck.resetMs },
      { status: 429, headers: { 'Retry-After': Math.ceil(aiCheck.resetMs / 1000).toString() } }
    )
  }

  const admin = createAdminClient()

  const { data: stepRow } = await admin
    .from('campaign_steps')
    .select('*, campaigns!inner(workspace_id, name, angle, value_prop, cta, target_persona, proof_points, icp_snapshot, language)')
    .eq('id', params.step_id)
    .single()

  if (!stepRow || (stepRow.campaigns as any)?.workspace_id !== guard.workspaceId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: profile } = await admin
    .from('workspace_profiles').select('*').eq('workspace_id', guard.workspaceId).single()

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const zodParsed = campaignStepAiWriteSchema.safeParse(rawBody)
  if (!zodParsed.success) return badRequest(zodParsed.error.issues)
  const { tone, instructions } = zodParsed.data
  const campaign = stepRow.campaigns as any
  const stepLabel = stepRow.step_type === 'initial' ? 'initial cold email' : `follow-up email #${stepRow.step_order} (sent ~${stepRow.delay_days} days after previous)`

  const variableRules = stepRow.step_type === 'initial'
    ? `CRITICAL: Template variables: The body MUST include {{first_name}} in the greeting (e.g., "Hi {{first_name}},") and {{company}} somewhere in the body. These are placeholders replaced with real prospect data at send time. DO NOT hardcode names or write "Hey there".`
    : `Variables: If the follow-up opens with a greeting, use {{first_name}} (e.g., "Hi {{first_name}},"). For short follow-ups with no greeting, omit it. You may use {{company}} where it fits naturally.`

  // 60-80 for initial (best practice 2026: first-touch performs better < 80 words),
  // 40-80 for follow-ups (already terse). Both share the same upper bound.
  const wordCap = 80

  const prompt = `You are an expert B2B cold outreach copywriter. Write a single ${stepLabel} for the following campaign.

${HUMAN_VOICE_RULES}

${languageDirective(campaign.language)}

${stepRow.step_type === 'initial' ? 'STRUCTURE (problem-first, non negotiable):\n- Open on the prospect\'s problem, not on us. NOT on our company or product.\n- Then one sentence on how that gets solved (benefit, not a product pitch).\n- Then one soft CTA.\n' : ''}
${variableRules}

CRITICAL: Anti-fabrication:
Do NOT invent specific facts. Keep the email general enough to work for the persona. Personalization happens later per-prospect.

CRITICAL: Meeting duration:
When proposing a meeting/call/demo, ALWAYS use {{meeting_duration}} for the duration.
Examples: "Worth a {{meeting_duration}}-minute call?" or "Happy to book a {{meeting_duration}}-min demo."
DO NOT hardcode "30 min", "20 min", or any specific duration.

GROUNDING CONTEXT:
Company: ${profile?.company_name || ''}
Product: ${profile?.product_description || ''}
Tone: ${tone || profile?.tone || 'professional'}

Campaign: ${campaign.name}
Target persona: ${campaign.target_persona || campaign.icp_snapshot?.icp || ''}
Angle: ${campaign.angle || campaign.icp_snapshot?.hook || ''}
CTA: ${campaign.cta || 'book a quick call'}
${(campaign.proof_points ?? '').trim() ? `\nPROOF (use AT MOST one of the points below, exactly as written, do NOT modify numbers or invent surrounding facts; only weave it in if it lands naturally — skip if not):\n${(campaign.proof_points as string).trim()}` : ''}
${instructions ? `\nSpecific instructions: ${instructions}` : ''}

Length: ${stepRow.step_type === 'initial' ? '60-80 words' : '40-80 words'}. Subject line: 4-8 words${stepRow.step_type === 'follow_up' ? '. Return null if threading on previous.' : ', problem or curiosity driven (never the product name).'} Paragraphs separated by \\n\\n.

${selfRevisionBlock(wordCap)}

Return ONLY valid JSON (no markdown):
{ "subject": "string or null", "body": "string" }`

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    temperature: 0.7,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
  const start = text.indexOf('{'); const end = text.lastIndexOf('}')
  const raw = start >= 0 && end >= 0 ? text.slice(start, end + 1) : '{}'

  let parsed: { subject: string | null; body: string }
  try { parsed = JSON.parse(raw) }
  catch { return NextResponse.json({ error: 'Failed to generate AI response' }, { status: 500 }) }

  const updates: Record<string, unknown> = { body: parsed.body, updated_at: new Date().toISOString() }
  if (parsed.subject !== undefined) updates.subject = parsed.subject

  const { data: step, error } = await admin
    .from('campaign_steps').update(updates).eq('id', params.step_id).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ step })
}
