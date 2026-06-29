import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { calculateProfileScore } from '@/lib/profile-quality'
import { billingGuard } from '@/lib/billing-guard'
import { morningBriefGenerateSchema, badRequest } from '@/lib/schemas'
import { getAnthropicClient } from '@/lib/anthropic'
import { checkAiRateLimit } from '@/lib/ratelimit'
import { logAiCall } from '@/lib/ai-cost'

export const maxDuration = 60

// Returns UTC start/end of "today" in the given IANA timezone
function todayBoundsUTC(tz: string): { start: Date; end: Date; dateStr: string } {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: tz }) // "YYYY-MM-DD"

  // Extract UTC offset via longOffset (e.g. "GMT-04:00")
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(now)
  const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const m = offsetPart.match(/GMT([+-]\d{2}:\d{2})/)
  const offset = m ? m[1] : '+00:00'

  const start = new Date(`${dateStr}T00:00:00${offset}`)
  const end   = new Date(`${dateStr}T23:59:59.999${offset}`)
  return { start, end, dateStr }
}

export async function POST(request: Request) {
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

  // workspace_id from body is validated as UUID but the authoritative value always
  // comes from billingGuard — prevents IDOR where body workspace_id != auth user's workspace.
  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const parsed = morningBriefGenerateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)

  const workspace_id = guard.workspaceId

  const admin = createAdminClient()

  const [{ data: profile }, { data: campaigns }, { count: prospectCount }, { data: ownerMember }] = await Promise.all([
    admin.from('workspace_profiles').select('*').eq('workspace_id', workspace_id).single(),
    admin.from('campaigns').select('*').eq('workspace_id', workspace_id),
    admin.from('prospects').select('*', { count: 'exact', head: true }).eq('workspace_id', workspace_id),
    admin.from('workspace_members').select('user_id').eq('workspace_id', workspace_id).eq('role', 'owner').single(),
  ])

  if (calculateProfileScore(profile ?? {}) < 30) {
    return NextResponse.json(
      { error: 'Complete your profile to generate a brief (AI quality score must reach 30+).' },
      { status: 400 }
    )
  }

  let firstName = 'there'
  if (ownerMember) {
    const { data: ownerData } = await admin.auth.admin.getUserById(ownerMember.user_id)
    const fullName = ownerData?.user?.user_metadata?.full_name ?? ownerData?.user?.email ?? ''
    firstName = fullName.split(' ')[0] || 'there'
  }

  // Timezone-aware "today"
  const tz = (profile?.booking_config as any)?.timezone ?? 'UTC'
  const { start: dayStart, end: dayEnd, dateStr: today } = todayBoundsUTC(tz)

  // Detect meetings today
  const { data: todayMeetings } = await admin
    .from('meetings')
    .select('meeting_at, duration_min, attendee_name, attendee_email, company_name, notes')
    .eq('workspace_id', workspace_id)
    .eq('status', 'scheduled')
    .gte('meeting_at', dayStart.toISOString())
    .lte('meeting_at', dayEnd.toISOString())
    .order('meeting_at', { ascending: true })

  const totalSent    = campaigns?.reduce((a, c) => a + (c.sent_count  || 0), 0) || 0
  const totalReplies = campaigns?.reduce((a, c) => a + (c.reply_count || 0), 0) || 0
  const replyRate    = totalSent > 0 ? ((totalReplies / totalSent) * 100).toFixed(1) : '0'

  const hasMeetings = (todayMeetings?.length ?? 0) > 0

  // ── Mode B — meetings today ──────────────────────────────────────────────
  if (hasMeetings) {
    const meetingsList = todayMeetings!.map((m, i) => {
      const time = new Date(m.meeting_at).toISOString()
      return `Meeting ${i + 1}:
  - Time: ${time} (${m.duration_min} min)
  - Attendee: ${m.attendee_name || 'Unknown'} (${m.attendee_email})
  - Company: ${m.company_name || 'Unknown'}${m.notes ? `\n  - Notes from user: ${m.notes}` : ''}`
    }).join('\n\n')

    const SCHEMA_B = `{
  "mode": "meetings_today",
  "date": "${today}",
  "greeting": "Good morning, ${firstName}!",
  "intro": "You have ${todayMeetings!.length} meeting${todayMeetings!.length > 1 ? 's' : ''} today. Here's your prep dossier for each.",
  "meetings": [
    {
      "meeting_at": "ISO timestamp",
      "duration_min": 30,
      "attendee_name": "...",
      "attendee_email": "...",
      "company_name": "...",
      "company_overview": "2-3 sentences using industry-typical patterns, not fabricated facts",
      "likely_pain_points": ["...", "...", "..."],
      "talking_points": ["...", "...", "..."],
      "discovery_questions": ["...", "...", "..."]
    }
  ],
  "market_trends_brief": [
    { "title": "...", "priority": "MED", "content": "1-2 sentence market signal" }
  ]
}`

    const promptB = `CRITICAL: Do NOT invent specific facts about any company. No fake fundraising amounts. No fake employee counts. No fake founding dates. No fake locations. No fake customer names. No fake news. If you don't have a specific fact, use industry-typical patterns and qualifying language ("companies at this stage typically...", "in this segment, common challenges include..."). The user will be in these meetings — any fabricated specific they mention based on your dossier will destroy their credibility.

VENDOR NAMES: Never name specific software vendors, tools, or platforms (e.g. no "Salesforce", "HubSpot", "Clay", "Apollo", "ChatGPT", "OpenAI", or any others). Use generic category language instead ("CRM", "outbound tooling", "AI assistant", "enrichment platform"). This applies to all sections of the brief.

You are an expert outbound sales strategist preparing a daily Morning Brief for a B2B SDR.

Company: ${profile?.company_name || 'their company'}
Product: ${profile?.product_description || 'B2B product'}
ICP: ${profile?.icp_description || 'B2B buyers'}
Tone: ${profile?.tone || 'professional'}
User first name: ${firstName}
Today's date: ${today}

They have ${todayMeetings!.length} meeting${todayMeetings!.length > 1 ? 's' : ''} scheduled today:

${meetingsList}

For each meeting, produce:
1. company_overview: 2-3 sentences. Use what's plausible based on company name and context. No fabricated specifics.
2. likely_pain_points: exactly 3 bullets, specific to this company's likely situation given the user's product
3. talking_points: exactly 3 bullets, angles that connect the user's product to the prospect's likely needs
4. discovery_questions: exactly 3 open-ended questions to drive the conversation

Then add market_trends_brief with exactly ONE relevant trend (compact — meetings are the focus).

Return ONLY valid JSON matching EXACTLY this structure:
${SCHEMA_B}

Rules:
- greeting must use "${firstName}" by name
- date must be "${today}"
- meetings array must contain exactly ${todayMeetings!.length} item${todayMeetings!.length > 1 ? 's' : ''}, in the same order as provided
- each meeting_at and attendee fields must match the input exactly
- market_trends_brief: exactly 1 item, priority must be HIGH, MED, or LOW
- Be specific and actionable. No fluff.

Return ONLY valid JSON. No markdown fences, no preamble, no trailing text.`

    let msgB: Awaited<ReturnType<typeof client.messages.create>>
    try {
      msgB = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 2500,
        messages:   [{ role: 'user', content: promptB }],
      })
      void logAiCall({
        source:        'morning_brief',
        workspace_id:  workspace_id,
        model:         'claude-sonnet-4-6',
        input_tokens:  msgB.usage?.input_tokens  ?? 0,
        output_tokens: msgB.usage?.output_tokens ?? 0,
        metadata:      { mode: 'B' },
      })
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err)
      console.error('[morning-brief] Anthropic call failed (Mode B):', detail)
      return NextResponse.json({ error: 'AI service temporarily unavailable. Please try again in a moment.' }, { status: 503 })
    }

    const text  = msgB.content[0].type === 'text' ? msgB.content[0].text : '{}'
    const start = text.indexOf('{')
    const end   = text.lastIndexOf('}')
    const raw   = start >= 0 && end >= 0 ? text.slice(start, end + 1) : '{}'

    let content: unknown
    try { content = JSON.parse(raw) }
    catch { return NextResponse.json({ error: 'Failed to parse AI response. Please try again.' }, { status: 500 }) }

    const { data: brief, error } = await admin
      .from('morning_briefs')
      .insert({ workspace_id, content, brief_date: today, sent_at: new Date().toISOString() })
      .select().single()

    if (error || !brief) return NextResponse.json({ error: 'Failed to save brief' }, { status: 500 })
    return NextResponse.json({ brief })
  }

  // ── Mode A — no meetings today ───────────────────────────────────────────
  const SCHEMA_A = `{
  "mode": "no_meetings",
  "date": "YYYY-MM-DD",
  "greeting": "Good morning, ${firstName}!",
  "intro": "1-2 sentence intro",
  "today_focus": { "title": "specific action", "rationale": "why it matters today" },
  "market_trends": [
    { "title": "...", "priority": "HIGH", "content": "2-3 sentence signal" },
    { "title": "...", "priority": "HIGH", "content": "2-3 sentence signal" },
    { "title": "...", "priority": "MED",  "content": "2-3 sentence signal" }
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

  const promptA = `You are an expert outbound sales strategist generating a daily Morning Brief for a B2B SDR.

VENDOR NAMES: Never name specific software vendors, tools, or platforms (e.g. no "Salesforce", "HubSpot", "Clay", "Apollo", "ChatGPT", "OpenAI", or any others). Use generic category language instead ("CRM", "outbound tooling", "AI assistant", "enrichment platform"). This applies to all sections including competitive_landscape.

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
${SCHEMA_A}

Rules:
- greeting must use "${firstName}" by name
- date must be "${today}"
- market_trends: exactly 3 items, priority must be HIGH, MED, or LOW
- competitive_landscape: exactly 2 items
- campaign_ideas: exactly 3 items, estimated_contacts must be a number
- Be specific, use real industry signals, numbers, dates where relevant
- No fluff — founder-grade quality, immediately actionable
- Keep each field concise: market_trends content ≤ 3 sentences, campaign angle ≤ 2 sentences

Return ONLY valid JSON. No markdown fences, no preamble, no trailing text.`

  let msgA: Awaited<ReturnType<typeof client.messages.create>>
  try {
    msgA = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 3000,
      messages:   [{ role: 'user', content: promptA }],
    })
    void logAiCall({
      source:        'morning_brief',
      workspace_id:  workspace_id,
      model:         'claude-sonnet-4-6',
      input_tokens:  msgA.usage?.input_tokens  ?? 0,
      output_tokens: msgA.usage?.output_tokens ?? 0,
      metadata:      { mode: 'A' },
    })
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[morning-brief] Anthropic call failed (Mode A):', detail)
    return NextResponse.json({ error: 'AI service temporarily unavailable. Please try again in a moment.' }, { status: 503 })
  }

  const text  = msgA.content[0].type === 'text' ? msgA.content[0].text : '{}'
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  const raw   = start >= 0 && end >= 0 ? text.slice(start, end + 1) : '{}'

  let content: unknown
  try { content = JSON.parse(raw) }
  catch { return NextResponse.json({ error: 'Failed to parse AI response. Please try again.' }, { status: 500 }) }

  const { data: brief, error } = await admin
    .from('morning_briefs')
    .insert({ workspace_id, content, brief_date: today, sent_at: new Date().toISOString() })
    .select().single()

  if (error || !brief) return NextResponse.json({ error: 'Failed to save brief' }, { status: 500 })
  return NextResponse.json({ brief })
}
