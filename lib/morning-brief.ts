import type { SupabaseClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'
import { calculateProfileScore } from '@/lib/profile-quality'
import { logAiCall } from '@/lib/ai-cost'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// Composition pure du Morning Coffee Brief : lecture des sources, calcul
// des stats, choix du mode (A = pas de rendez-vous du jour, B = rendez-vous
// du jour), composition des consignes, appel au modèle, journalisation du
// coût, extraction du JSON. Le module ne connaît ni `next/server`, ni le
// SDK Supabase serveur, ni HTTP : il reçoit son `admin` et son `client` en
// paramètre pour rester testable sans mocker de singleton et pour que
// l'ordre des échecs côté appelant (getAnthropicClient() jette AVANT
// billingGuard) soit conservé à l'octet près.
//
// L'INSERT dans morning_briefs reste chez l'appelant : le bouton
// « Regenerate today's brief » peut réécrire plusieurs fois par jour,
// l'envoi automatique du lot 4 ne le pourra pas et devra réserver sous
// contrainte d'unicité (index partiel `morning_briefs_cron_daily_uniq`).
// Si le module insérait, les deux appelants ne pourraient plus diverger.

export type MorningBriefFailure =
  | { ok: false; reason: 'profile_score_too_low' }
  | { ok: false; reason: 'ai_unavailable'; detail: string }
  | { ok: false; reason: 'ai_unparseable' }

export type MorningBriefResult =
  | { ok: true; content: unknown; mode: 'A' | 'B'; briefDate: string }
  | MorningBriefFailure

// ── UTC bounds of "today" in an IANA timezone ────────────────────────────
//
// ⚠️ DÉFAUT CONNU, non corrigé ici : le décalage est échantillonné à
// `now` (l'instant présent), pas à minuit local dans `tz`. Un jour de
// bascule DST, les bornes de la journée glissent d'une heure — voir le
// test « DST fall-back day » dans morning-brief.test.ts qui pointe l'écart
// sans le corriger. À corriger au lot 2 bis (Morning Brief).
//
// `now` est un paramètre optionnel pour rendre la fonction testable de
// manière déterministe : le repo n'utilise nulle part de fausses horloges
// (vi.useFakeTimers absent), on copie donc le patron de convertNaiveLocalToUtc
// (meeting-tz.ts) qui reçoit ses instants en argument.
export function todayBoundsUTC(
  tz: string,
  now: Date = new Date(),
): { start: Date; end: Date; dateStr: string } {
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: tz }) // "YYYY-MM-DD"

  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(now)
  const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const m = offsetPart.match(/GMT([+-]\d{2}:\d{2})/)
  const offset = m ? m[1] : '+00:00'

  const start = new Date(`${dateStr}T00:00:00${offset}`)
  const end   = new Date(`${dateStr}T23:59:59.999${offset}`)
  return { start, end, dateStr }
}

// ── Slice the first {...} block out of a model reply ─────────────────────
//
// Factorisation stricte des trois lignes `indexOf` / `lastIndexOf` /
// `slice` partagées entre les deux modes. Le ternaire
// `content[0].type === 'text' ? content[0].text : '{}'` reste chez
// l'appelant, une fois par mode : c'est lui qui peut jeter sur un
// `content` vide, et ce tir doit rester HORS du `try` de
// `messages.create` (sinon un `content` vide devient `ai_unavailable`
// / 503 au lieu du 500 générique — delta observable non couvert par
// le contrat).
export function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  return start >= 0 && end >= 0 ? text.slice(start, end + 1) : '{}'
}

// ── Prompt inputs ────────────────────────────────────────────────────────

type ProfileForPrompt = {
  company_name?:        string | null
  product_description?: string | null
  icp_description?:     string | null
  tone?:                string | null
} | null | undefined

export type MeetingForBrief = {
  meeting_at:     string
  duration_min:   number
  attendee_name:  string | null
  attendee_email: string
  company_name:   string | null
  notes:          string | null
}

export type BuildPromptAInput = {
  firstName:      string
  today:          string
  profile:        ProfileForPrompt
  campaignsCount: number
  totalSent:      number
  replyRate:      string
  prospectCount:  number
}

export type BuildPromptBInput = {
  firstName: string
  today:     string
  profile:   ProfileForPrompt
  meetings:  MeetingForBrief[]
}

// ── Prompt B — meetings today ────────────────────────────────────────────
//
// ⚠️ DÉFAUT CONNU, non corrigé ici : les champs saisis par le prospect
// (`attendee_name`, `company_name`, `notes`) sont interpolés dans la
// consigne avec ordre de les recopier à l'identique. Assainissement au
// rendu → lot 3 (Morning Brief).
export function buildPromptB(input: BuildPromptBInput): string {
  const { firstName, today, profile, meetings } = input

  const meetingsList = meetings.map((m, i) => {
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
  "intro": "You have ${meetings.length} meeting${meetings.length > 1 ? 's' : ''} today. Here's your prep dossier for each.",
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

  return `CRITICAL: Do NOT invent specific facts about any company. No fake fundraising amounts. No fake employee counts. No fake founding dates. No fake locations. No fake customer names. No fake news. If you don't have a specific fact, use industry-typical patterns and qualifying language ("companies at this stage typically...", "in this segment, common challenges include..."). The user will be in these meetings — any fabricated specific they mention based on your dossier will destroy their credibility.

VENDOR NAMES: Never name specific software vendors, tools, or platforms (e.g. no "Salesforce", "HubSpot", "Clay", "Apollo", "ChatGPT", "OpenAI", or any others). Use generic category language instead ("CRM", "outbound tooling", "AI assistant", "enrichment platform"). This applies to all sections of the brief.

You are an expert outbound sales strategist preparing a daily Morning Brief for a B2B SDR.

Company: ${profile?.company_name || 'their company'}
Product: ${profile?.product_description || 'B2B product'}
ICP: ${profile?.icp_description || 'B2B buyers'}
Tone: ${profile?.tone || 'professional'}
User first name: ${firstName}
Today's date: ${today}

They have ${meetings.length} meeting${meetings.length > 1 ? 's' : ''} scheduled today:

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
- meetings array must contain exactly ${meetings.length} item${meetings.length > 1 ? 's' : ''}, in the same order as provided
- each meeting_at and attendee fields must match the input exactly
- market_trends_brief: exactly 1 item, priority must be HIGH, MED, or LOW
- Be specific and actionable. No fluff.

Return ONLY valid JSON. No markdown fences, no preamble, no trailing text.`
}

// ── Prompt A — no meetings today ─────────────────────────────────────────
export function buildPromptA(input: BuildPromptAInput): string {
  const { firstName, today, profile, campaignsCount, totalSent, replyRate, prospectCount } = input

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

  return `You are an expert outbound sales strategist generating a daily Morning Brief for a B2B SDR.

VENDOR NAMES: Never name specific software vendors, tools, or platforms (e.g. no "Salesforce", "HubSpot", "Clay", "Apollo", "ChatGPT", "OpenAI", or any others). Use generic category language instead ("CRM", "outbound tooling", "AI assistant", "enrichment platform"). This applies to all sections including competitive_landscape.

Company: ${profile?.company_name || 'their company'}
Product: ${profile?.product_description || 'B2B product'}
ICP: ${profile?.icp_description || 'B2B buyers'}
Tone: ${profile?.tone || 'professional'}
User first name: ${firstName}
Today's date: ${today}

Campaign stats: ${campaignsCount} campaigns · ${totalSent} emails sent · ${replyRate}% reply rate
Prospects in DB: ${prospectCount}

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
}

// ── Full generation, mode A or B ─────────────────────────────────────────
//
// ⚠️ RÉGIME DES EXCEPTIONS — préservé à l'identique de la route d'avant.
// Le `try` couvre EXACTEMENT `messages.create` + `logAiCall` ; l'extraction
// du texte et le `JSON.parse` restent en dehors (le `JSON.parse` a son
// propre `try` → `ai_unparseable`). Le module ne rattrape rien d'autre :
// un `booking_config.timezone` invalide fait jeter `todayBoundsUTC` et
// remonte nu → 500 générique de Next côté appelant, comme aujourd'hui.
export async function generateMorningBrief(args: {
  admin:       SupabaseClient
  client:      Anthropic
  workspaceId: string
}): Promise<MorningBriefResult> {
  const { admin, client, workspaceId } = args

  const [{ data: profile }, { data: campaigns }, { count: prospectCount }, { data: ownerMember }] = await Promise.all([
    admin.from('workspace_profiles').select('*').eq('workspace_id', workspaceId).single(),
    admin.from('campaigns').select('*').eq('workspace_id', workspaceId),
    admin.from('prospects').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
    admin.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('role', 'owner').single(),
  ])

  if (calculateProfileScore(profile ?? {}) < 30) {
    return { ok: false, reason: 'profile_score_too_low' }
  }

  let firstName = 'there'
  if (ownerMember) {
    const { data: ownerData } = await admin.auth.admin.getUserById(ownerMember.user_id)
    const fullName = ownerData?.user?.user_metadata?.full_name ?? ownerData?.user?.email ?? ''
    firstName = fullName.split(' ')[0] || 'there'
  }

  const tz = (profile?.booking_config as { timezone?: string } | null)?.timezone ?? 'UTC'
  const { start: dayStart, end: dayEnd, dateStr: today } = todayBoundsUTC(tz)

  const { data: todayMeetings } = await admin
    .from('meetings')
    .select('meeting_at, duration_min, attendee_name, attendee_email, company_name, notes')
    .eq('workspace_id', workspaceId)
    .eq('status', 'scheduled')
    .gte('meeting_at', dayStart.toISOString())
    .lte('meeting_at', dayEnd.toISOString())
    .order('meeting_at', { ascending: true })

  const totalSent    = campaigns?.reduce((a: number, c: { sent_count?: number | null })  => a + (c.sent_count  || 0), 0) || 0
  const totalReplies = campaigns?.reduce((a: number, c: { reply_count?: number | null }) => a + (c.reply_count || 0), 0) || 0
  const replyRate    = totalSent > 0 ? ((totalReplies / totalSent) * 100).toFixed(1) : '0'

  const hasMeetings = (todayMeetings?.length ?? 0) > 0

  if (hasMeetings) {
    const promptB = buildPromptB({
      firstName,
      today,
      profile: profile as ProfileForPrompt,
      meetings: todayMeetings as MeetingForBrief[],
    })

    let msgB: Awaited<ReturnType<typeof client.messages.create>>
    try {
      msgB = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 2500,
        messages:   [{ role: 'user', content: promptB }],
      })
      void logAiCall({
        source:        'morning_brief',
        workspace_id:  workspaceId,
        model:         'claude-sonnet-4-6',
        input_tokens:  msgB.usage?.input_tokens  ?? 0,
        output_tokens: msgB.usage?.output_tokens ?? 0,
        metadata:      { mode: 'B' },
      })
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err)
      console.error('[morning-brief] Anthropic call failed (Mode B):', detail)
      return { ok: false, reason: 'ai_unavailable', detail }
    }

    const text = msgB.content[0].type === 'text' ? msgB.content[0].text : '{}'
    const raw  = extractJsonObject(text)

    let content: unknown
    try { content = JSON.parse(raw) }
    catch { return { ok: false, reason: 'ai_unparseable' } }

    return { ok: true, content, mode: 'B', briefDate: today }
  }

  const promptA = buildPromptA({
    firstName,
    today,
    profile: profile as ProfileForPrompt,
    campaignsCount: campaigns?.length || 0,
    totalSent,
    replyRate,
    prospectCount: prospectCount || 0,
  })

  let msgA: Awaited<ReturnType<typeof client.messages.create>>
  try {
    msgA = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 3000,
      messages:   [{ role: 'user', content: promptA }],
    })
    void logAiCall({
      source:        'morning_brief',
      workspace_id:  workspaceId,
      model:         'claude-sonnet-4-6',
      input_tokens:  msgA.usage?.input_tokens  ?? 0,
      output_tokens: msgA.usage?.output_tokens ?? 0,
      metadata:      { mode: 'A' },
    })
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[morning-brief] Anthropic call failed (Mode A):', detail)
    return { ok: false, reason: 'ai_unavailable', detail }
  }

  const text = msgA.content[0].type === 'text' ? msgA.content[0].text : '{}'
  const raw  = extractJsonObject(text)

  let content: unknown
  try { content = JSON.parse(raw) }
  catch { return { ok: false, reason: 'ai_unparseable' } }

  return { ok: true, content, mode: 'A', briefDate: today }
}
