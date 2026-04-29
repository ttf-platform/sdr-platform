import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateProfileScore } from '@/lib/profile-quality'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const body = await request.json()
  const { campaign_id, overwrite = false } = body

  if (!campaign_id) return NextResponse.json({ error: 'campaign_id required' }, { status: 400 })

  const admin = createAdminClient()

  const { data: campaign } = await admin
    .from('campaigns')
    .select('*')
    .eq('id', campaign_id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const { data: profile } = await admin
    .from('workspace_profiles')
    .select('*')
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (calculateProfileScore(profile ?? {}) < 30) {
    return NextResponse.json(
      { error: 'Complete your workspace profile to generate sequences (AI quality score must reach 30+).' },
      { status: 400 },
    )
  }

  // If steps already exist and overwrite not requested, delete them first when overwrite=true
  if (overwrite) {
    await admin.from('campaign_steps').delete().eq('campaign_id', campaign_id)
  } else {
    const { count } = await admin
      .from('campaign_steps')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaign_id)
    if (count && count > 0) {
      return NextResponse.json({ error: 'Sequence already exists. Pass overwrite: true to regenerate.' }, { status: 409 })
    }
  }

  const icp_industries = Array.isArray(profile?.icp_industries) ? profile.icp_industries.join(', ') : (profile?.icp_industries ?? '')

  const prompt = `You are an expert B2B sales copywriter for cold outbound campaigns. Write the initial cold outreach email for a sequence.

CRITICAL — Template variables (mandatory):
The body MUST include:
- {{first_name}} in the greeting line (e.g., "Hi {{first_name}},")
- {{company}} somewhere naturally in the body
These are placeholders replaced with each prospect's real data at send time.
DO NOT hardcode any name, company, or generic substitute like "Hey there", "Hi friend", or "Hi [Name]".
DO NOT skip {{company}} — it must appear in the body.
Optional: include {{title}} if referencing their role adds context.

CRITICAL — Anti-fabrication:
Do NOT invent specific facts about prospects. No fake fundraising, no fake employee counts, no named clients. Keep it compelling but general enough to work for the persona. Fabricated specifics destroy credibility.

Company info:
- Company: ${profile?.company_name || 'the company'}
- Description: ${profile?.product_description || ''}
- Value proposition: ${profile?.value_proposition || ''}
- Sender name: ${profile?.sender_name || 'the sender'}
- Tone: ${profile?.tone || 'professional'}

Campaign info:
- Target persona: ${campaign.target_persona || campaign.icp_snapshot?.icp || ''}
- Angle for this campaign: ${campaign.angle || ''}
- Specific value prop: ${campaign.value_prop || campaign.icp_snapshot?.hook || ''}
- Desired CTA: ${campaign.cta || 'book a quick call'}

Audience context:
- ICP: ${profile?.icp_description || ''}
- Industries: ${icp_industries}
- Company size: ${profile?.icp_company_size || ''}
- Pain points: ${profile?.pain_points || ''}

Writing rules:
- Use plain text only. No HTML, no bullet lists, no formatting tags.
- Keep the initial email SHORT: 80-120 words.
- Subject line: 4-8 words, curiosity or value-driven, no clickbait.
- Sound like a real human SDR, not a marketing robot.
- Include the CTA clearly.
- Paragraphs separated by \\n\\n.

Return ONLY valid JSON (no markdown, no preamble, no explanation):
{
  "initial": {
    "subject": "string",
    "body": "string"
  }
}`

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const raw = start >= 0 && end >= 0 ? text.slice(start, end + 1) : '{}'

  let parsed: { initial: { subject: string; body: string } }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Failed to generate AI sequence' }, { status: 500 })
  }

  const rows = [
    {
      campaign_id,
      step_order: 0,
      step_type: 'initial',
      delay_days: 0,
      subject: parsed.initial.subject,
      body: parsed.initial.body,
      include_booking_link: false,
    },
    // One empty follow-up as a starter template — user fills via AI Write or manually
    {
      campaign_id,
      step_order: 1,
      step_type: 'follow_up',
      delay_days: 3,
      subject: null,
      body: '',
      include_booking_link: false,
    },
  ]

  const { data: steps, error } = await admin
    .from('campaign_steps')
    .insert(rows)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ steps: steps?.sort((a, b) => a.step_order - b.step_order) ?? [] })
}
