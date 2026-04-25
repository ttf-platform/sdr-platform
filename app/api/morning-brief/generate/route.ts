import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request) {
  const { workspace_id } = await request.json()
  if (!workspace_id) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 })

  const admin = createAdminClient()

  const [{ data: profile }, { data: campaigns }, { count: prospectCount }, { data: ownerMember }] = await Promise.all([
    admin.from('workspace_profiles').select('*').eq('workspace_id', workspace_id).single(),
    admin.from('campaigns').select('*').eq('workspace_id', workspace_id),
    admin.from('prospects').select('*', { count: 'exact', head: true }).eq('workspace_id', workspace_id),
    admin.from('workspace_members').select('user_id').eq('workspace_id', workspace_id).eq('role', 'owner').single(),
  ])

  if (!profile?.product_description || profile.product_description.length < 30) {
    return NextResponse.json(
      { error: 'Add a more detailed company description (30+ characters) before generating a brief.' },
      { status: 400 }
    )
  }

  let firstName = 'there'
  if (ownerMember) {
    const { data: ownerData } = await admin.auth.admin.getUserById(ownerMember.user_id)
    const fullName = ownerData?.user?.user_metadata?.full_name ?? ownerData?.user?.email ?? ''
    firstName = fullName.split(' ')[0] || 'there'
  }

  const totalSent    = campaigns?.reduce((a, c) => a + (c.sent_count  || 0), 0) || 0
  const totalReplies = campaigns?.reduce((a, c) => a + (c.reply_count || 0), 0) || 0
  const replyRate    = totalSent > 0 ? ((totalReplies / totalSent) * 100).toFixed(1) : '0'
  const today        = new Date().toISOString().split('T')[0]

  const SCHEMA = `{
  "mode": "no_meetings",
  "date": "YYYY-MM-DD",
  "greeting": "Good morning, ${firstName}!",
  "intro": "1-2 sentence intro",
  "today_focus": { "title": "specific action", "rationale": "why it matters today" },
  "market_trends": [
    { "title": "...", "priority": "HIGH", "content": "detailed paragraph" },
    { "title": "...", "priority": "HIGH", "content": "..." },
    { "title": "...", "priority": "MED",  "content": "..." }
  ],
  "competitive_landscape": [
    { "competitor_type": "...", "what_they_do": "...", "positioning_opportunity": "..." },
    { "competitor_type": "...", "what_they_do": "...", "positioning_opportunity": "..." }
  ],
  "campaign_ideas": [
    { "name": "...", "target_persona": "...", "angle": "...", "why_now": "...", "estimated_contacts": 150 },
    { "name": "...", "target_persona": "...", "angle": "...", "why_now": "...", "estimated_contacts": 80 },
    { "name": "...", "target_persona": "...", "angle": "...", "why_now": "...", "estimated_contacts": 200 }
  ]
}`

  const prompt = `You are an expert outbound sales strategist generating a daily Morning Brief for a B2B SDR.

Company: ${profile?.company_name || 'their company'}
Product: ${profile?.product_description || 'B2B product'}
ICP: ${profile?.icp_description || 'B2B buyers'}
Tone: ${profile?.tone || 'professional'}
User first name: ${firstName}
Today's date: ${today}

Campaign stats: ${campaigns?.length || 0} campaigns · ${totalSent} emails sent · ${replyRate}% reply rate
Prospects in DB: ${prospectCount || 0}

They have NO meetings today — this is a "Market Intelligence Day" brief.

Generate a JSON object matching EXACTLY this structure:
${SCHEMA}

Rules:
- greeting must use "${firstName}" by name
- date must be "${today}"
- market_trends: exactly 3 items, priority must be HIGH, MED, or LOW
- competitive_landscape: exactly 2 items
- campaign_ideas: exactly 3 items, estimated_contacts must be a number
- Be specific, use real industry signals, numbers, dates where relevant
- No fluff — founder-grade quality, immediately actionable

Return ONLY valid JSON. No markdown fences, no preamble, no trailing text.`

  const msg = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 2000,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text  = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  const raw   = start >= 0 && end >= 0 ? text.slice(start, end + 1) : '{}'

  let content: unknown
  try {
    content = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Failed to parse Claude response' }, { status: 500 })
  }

  const { data: brief, error } = await admin
    .from('morning_briefs')
    .insert({ workspace_id, content, brief_date: today, sent_at: new Date().toISOString() })
    .select().single()

  if (error || !brief) return NextResponse.json({ error: 'Failed to save brief' }, { status: 500 })
  return NextResponse.json({ brief })
}
