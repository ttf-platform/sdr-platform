import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { campaignStepAiWriteSchema, badRequest } from '@/lib/schemas'
import { getAnthropicClient } from '@/lib/anthropic'

export async function POST(request: Request, { params }: { params: { id: string; step_id: string } }) {
  const client = getAnthropicClient()
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  const { data: stepRow } = await admin
    .from('campaign_steps')
    .select('*, campaigns!inner(workspace_id, name, angle, value_prop, cta, target_persona, icp_snapshot)')
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
    ? `CRITICAL — Template variables: The body MUST include {{first_name}} in the greeting (e.g., "Hi {{first_name}},") and {{company}} somewhere in the body. These are placeholders replaced with real prospect data at send time. DO NOT hardcode names or write "Hey there".`
    : `Variables: If the follow-up opens with a greeting, use {{first_name}} (e.g., "Hi {{first_name}},"). For short follow-ups with no greeting, omit it. You may use {{company}} where it fits naturally.`

  const prompt = `You are an expert B2B sales copywriter. Write a single ${stepLabel} for the following campaign.

${variableRules}

CRITICAL: Do NOT invent specific facts. Keep the email general enough to work for the persona — personalization happens later per-prospect.

Company: ${profile?.company_name || ''}
Product: ${profile?.product_description || ''}
Sender: ${profile?.sender_name || ''}
Tone: ${tone || profile?.tone || 'professional'}

Campaign: ${campaign.name}
Target persona: ${campaign.target_persona || campaign.icp_snapshot?.icp || ''}
Angle: ${campaign.angle || campaign.icp_snapshot?.hook || ''}
CTA: ${campaign.cta || 'book a quick call'}
${instructions ? `\nSpecific instructions: ${instructions}` : ''}

CRITICAL — Meeting duration:
When proposing a meeting/call/demo, ALWAYS use {{meeting_duration}} for the duration.
Examples: "Worth a {{meeting_duration}}-minute call?" or "Happy to book a {{meeting_duration}}-min demo."
DO NOT hardcode "30 min", "20 min", or any specific duration.

Rules:
- Plain text only. No HTML, no bullet points.
- ${stepRow.step_type === 'initial' ? '80-120 words' : '40-80 words'}
- Subject line: 4-8 words${stepRow.step_type === 'follow_up' ? '. Return null if threading on previous.' : ''}
- One clear human voice throughout.

Return ONLY valid JSON (no markdown):
{ "subject": "string or null", "body": "string" }`

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
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
