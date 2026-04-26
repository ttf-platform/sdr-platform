import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request, { params }: { params: { id: string; step_id: string } }) {
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

  const body = await request.json()
  const { tone, instructions } = body
  const campaign = stepRow.campaigns as any
  const stepLabel = stepRow.step_type === 'initial' ? 'initial cold email' : `follow-up email #${stepRow.step_order} (sent ~${stepRow.delay_days} days after previous)`

  const prompt = `You are an expert B2B sales copywriter. Rewrite a single ${stepLabel} for the following campaign.

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
