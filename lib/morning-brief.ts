import type { SupabaseClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'
import { calculateProfileScore } from '@/lib/profile-quality'
import { logAiCall } from '@/lib/ai-cost'
import { localInstantUTC, todayBoundsUTC } from './local-day'
import { MORNING_BRIEF_MAX_MEETINGS } from './morning-brief-email'

// L'arithmétique de journée locale (localInstantUTC, todayBoundsUTC) est
// déplacée dans lib/local-day.ts (lot 5a) — module strictement pur pour être
// consommable côté client sans traîner ce module de génération. Ré-exportée
// ici pour que les consommateurs actuels (route generate, cron, schedule,
// tests) n'aient rien à changer.
export { localInstantUTC, todayBoundsUTC }

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
  // Lot 5c-0 : 4e variante, nommee au lieu d etre confondue avec une reponse
  // illisible. Le modele a rendu stop_reason='max_tokens' — le JSON est
  // tronque a mi-chaine, le brief n a rien produit d exploitable. Message
  // utilisateur distinct, compteur cron distinct. QUASI INATTEIGNABLE apres
  // le plafond de 12 rendez-vous + max_tokens 8000 + timeout 240 s : c est
  // un filet de diagnostic, pas un correctif utilisateur.
  | { ok: false; reason: 'ai_truncated' }
  // Lot 5b-bis : etat impossible en pratique — le predicat decideRegen ne
  // peut pas rendre `meetings_only` sans qu'il y ait au moins un nouveau
  // rendez-vous. Rendu par un `reason` d echec explicite (pas un repli
  // silencieux sur le Mode A) pour tracer si un jour la route recoit
  // `kind='meetings_only'` sans avoir la donnee correspondante.
  | { ok: false; reason: 'no_meetings_for_prep' }

// Lot 5b-bis : `mode` etendu a 'C' pour la 3e forme (« meetings_prep »).
// Le contenu porte `mode: 'meetings_prep'` cote JSON, `MorningBriefResult
// .mode` = 'C' cote sortie du module — meme convention que 'A' / 'B'.
export type MorningBriefResult =
  | { ok: true; content: unknown; mode: 'A' | 'B' | 'C'; briefDate: string }
  | MorningBriefFailure

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

// ── Prompt C — meetings-only regen (lot 5b-bis) ──────────────────────────
//
// Derive de buildPromptB SANS la ligne de consigne « veille marche » et
// SANS `market_trends_brief` dans SCHEMA_C. La sortie est un sous-ensemble
// STRICT de la sortie B — on ne peut pas depasser 8000 tokens (max_tokens
// inchange, garanti par le plafond de 12 rendez-vous du lot 5c-0).
// content porte `mode: 'meetings_prep'` cote JSON ; le module rend `'C'`
// cote sortie.
export function buildPromptC(input: BuildPromptBInput): string {
  const { firstName, today, profile, meetings } = input

  const meetingsList = meetings.map((m, i) => {
    const time = new Date(m.meeting_at).toISOString()
    return `Meeting ${i + 1}:
  - Time: ${time} (${m.duration_min} min)
  - Attendee: ${m.attendee_name || 'Unknown'} (${m.attendee_email})
  - Company: ${m.company_name || 'Unknown'}${m.notes ? `\n  - Notes from user: ${m.notes}` : ''}`
  }).join('\n\n')

  const SCHEMA_C = `{
  "mode": "meetings_prep",
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

Return ONLY valid JSON matching EXACTLY this structure:
${SCHEMA_C}

Rules:
- greeting must use "${firstName}" by name
- date must be "${today}"
- meetings array must contain exactly ${meetings.length} item${meetings.length > 1 ? 's' : ''}, in the same order as provided
- each meeting_at and attendee fields must match the input exactly
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
  /**
   * Optional « maintenant » utilisé pour désigner la journée locale du brief.
   * Défaut : `new Date()` — comportement inchangé pour la route existante.
   * Nécessaire pour le cron du lot 4 : la branche « rattrapage de la veille »
   * doit générer le contenu du JOUR DE L'ÉCHÉANCE (rendez-vous et date dans
   * la consigne), pas celui du réveil. Sans ce paramètre, un rattrapage
   * après minuit local produirait le contenu d'aujourd'hui rangé sous
   * `brief_date = hier`.
   */
  now?:        Date
  /**
   * Lot 5b-bis : `full` produit le brief entier (Mode A ou B selon la
   * presence de rendez-vous). `meetings_only` produit la 3e forme (Mode C),
   * dossier de rendez-vous SANS veille marche ni suggestions de campagnes.
   * Defaut `'full'` — le cron n'est pas modifie. La route recalcule la
   * decision cote serveur (§1.4) et transmet le kind resolu.
   */
  kind?:       'full' | 'meetings_only'
}): Promise<MorningBriefResult> {
  const { admin, client, workspaceId, now } = args
  const kind = args.kind ?? 'full'

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
  const { start: dayStart, end: dayEnd, dateStr: today } = todayBoundsUTC(tz, now)

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

  // ── Chemin C — meetings_only (lot 5b-bis) ─────────────────────────────
  // Insere AVANT le `if (hasMeetings)` pour ne pas re-indenter la queue de
  // fonction (Mode A). Etat impossible : `meetings_only` sans rendez-vous —
  // le predicat decideRegen ne peut pas le produire, mais on trace via
  // `no_meetings_for_prep` plutot que de retomber silencieusement sur
  // le Mode A.
  if (kind === 'meetings_only') {
    if (!hasMeetings) {
      return { ok: false, reason: 'no_meetings_for_prep' }
    }

    // Meme plafonnement et conservation du total qu'au Mode B.
    // ⚠️ Consequence connue et acceptee : a plus de 12 rendez-vous, le slice
    // trie par meeting_at peut exclure precisement le NOUVEAU rendez-vous
    // qui a rallume le bouton. A quatre comptes internes, on l'accepte —
    // pas corrige dans ce lot.
    const allMeetingsC = (todayMeetings ?? []) as MeetingForBrief[]
    const totalMeetingsC = allMeetingsC.length
    const meetingsForPromptC = allMeetingsC.slice(0, MORNING_BRIEF_MAX_MEETINGS)

    const promptC = buildPromptC({
      firstName,
      today,
      profile: profile as ProfileForPrompt,
      meetings: meetingsForPromptC,
    })

    let msgC: Awaited<ReturnType<typeof client.messages.create>>
    try {
      // max_tokens INCHANGE (8000) : la sortie de C est un sous-ensemble
      // strict de B (schema sans market_trends_brief). Meme surcharge par
      // appel que B, meme journal, meme filet stop_reason.
      msgC = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 8000,
        messages:   [{ role: 'user', content: promptC }],
      }, { timeout: 240_000, maxRetries: 0 })
      void logAiCall({
        source:        'morning_brief',
        workspace_id:  workspaceId,
        model:         'claude-sonnet-4-6',
        input_tokens:  msgC.usage?.input_tokens  ?? 0,
        output_tokens: msgC.usage?.output_tokens ?? 0,
        // 🔴 metadata.mode = 'C' (pas 'B') — sinon le journal de cout ment
        // sur chaque appel meetings_only.
        metadata:      { mode: 'C', stop_reason: msgC.stop_reason ?? null },
      })
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err)
      console.error('[morning-brief] Anthropic call failed (Mode C):', detail)
      void logAiCall({
        source:        'morning_brief',
        workspace_id:  workspaceId,
        model:         'claude-sonnet-4-6',
        input_tokens:  0,
        output_tokens: 0,
        metadata:      { mode: 'C', failed: true, detail },
      })
      return { ok: false, reason: 'ai_unavailable', detail }
    }

    // Meme filet que Mode B : reprise du patron du lot 5c-0. Sans lui, un
    // chemin de generation neuf reintroduit exactement le defaut corrige.
    if (msgC.stop_reason === 'max_tokens') {
      return { ok: false, reason: 'ai_truncated' }
    }

    const textC = msgC.content[0].type === 'text' ? msgC.content[0].text : '{}'
    const rawC  = extractJsonObject(textC)

    let contentC: unknown
    try { contentC = JSON.parse(rawC) }
    catch { return { ok: false, reason: 'ai_unparseable' } }

    if (contentC && typeof contentC === 'object') {
      if (totalMeetingsC > MORNING_BRIEF_MAX_MEETINGS) {
        (contentC as Record<string, unknown>).total_meetings_today = totalMeetingsC
      }
      // Lot « longueur » — meme raison que Mode B : meetings_expected
      // toujours pose pour rendre le manque detectable.
      (contentC as Record<string, unknown>).meetings_expected = meetingsForPromptC.length
    }

    return { ok: true, content: contentC, mode: 'C', briefDate: today }
  }

  if (hasMeetings) {
    // Plafonner l ENTREE : on ne paie pas ce qu on va jeter au rendu, et
    // la sortie du modele ne peut pas croitre au-dela de ~500 tokens x 12
    // rendez-vous (mesure), soit un pire cas de ~6 150 tokens couvert par
    // max_tokens: 8000 (30 % de marge). Les six interpolations de
    // meetings.length dans buildPromptB voient le nombre PLAFONNE — donc
    // le modele n a plus a « faire tenir » 15 dossiers dans un slice de 12.
    const allMeetings = (todayMeetings ?? []) as MeetingForBrief[]
    const totalMeetings = allMeetings.length
    const meetingsForPrompt = allMeetings.slice(0, MORNING_BRIEF_MAX_MEETINGS)

    const promptB = buildPromptB({
      firstName,
      today,
      profile: profile as ProfileForPrompt,
      meetings: meetingsForPrompt,
    })

    let msgB: Awaited<ReturnType<typeof client.messages.create>>
    try {
      // Surcharges par APPEL, jamais sur le singleton (lib/anthropic.ts est
      // partage par le chatbot, draft-generation, ai-suggestions, etc.).
      // - max_tokens: 8000 — pire cas mesure a 12 rendez-vous ~6 150 tokens,
      //   30 % de marge. Le cout ne change pas : on paie les tokens produits,
      //   pas le plafond.
      // - timeout: 240_000 — 8 000 tokens depassent largement 60 s (defaut
      //   singleton). maxDuration=300 des routes couvre 240 s + envoi.
      // - maxRetries: 0 — le defaut du singleton est 2, donc jusqu a 3
      //   generations facturees pour une tentative logique, dont aucune n
      //   est enregistree si le timeout tombe. Le cron reessaie deja quatre
      //   fois (fenetre CATCH_UP_MS de 2 h).
      msgB = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 8000,
        messages:   [{ role: 'user', content: promptB }],
      }, { timeout: 240_000, maxRetries: 0 })
      void logAiCall({
        source:        'morning_brief',
        workspace_id:  workspaceId,
        model:         'claude-sonnet-4-6',
        input_tokens:  msgB.usage?.input_tokens  ?? 0,
        output_tokens: msgB.usage?.output_tokens ?? 0,
        metadata:      { mode: 'B', stop_reason: msgB.stop_reason ?? null },
      })
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err)
      console.error('[morning-brief] Anthropic call failed (Mode B):', detail)
      // Un appel avorte est facture et n etait enregistre NULLE PART sans ce
      // logAiCall dans le catch. Fire-and-forget (void) : un journal qui
      // casse la generation serait pire que pas de journal.
      void logAiCall({
        source:        'morning_brief',
        workspace_id:  workspaceId,
        model:         'claude-sonnet-4-6',
        input_tokens:  0,
        output_tokens: 0,
        metadata:      { mode: 'B', failed: true, detail },
      })
      return { ok: false, reason: 'ai_unavailable', detail }
    }

    // Detecter la troncature AVANT le JSON.parse : un stop_reason='max_tokens'
    // rend un JSON tronque a mi-chaine qui echouerait en 'ai_unparseable', un
    // message trompeur (le contenu n est pas illisible, il est incomplet).
    if (msgB.stop_reason === 'max_tokens') {
      return { ok: false, reason: 'ai_truncated' }
    }

    const text = msgB.content[0].type === 'text' ? msgB.content[0].text : '{}'
    const raw  = extractJsonObject(text)

    let content: unknown
    try { content = JSON.parse(raw) }
    catch { return { ok: false, reason: 'ai_unparseable' } }

    // Porter le nombre TOTAL de rendez-vous dans le content, uniquement
    // quand il depasse le plafond, pour que composeMorningBriefBlock puisse
    // afficher « les 12 premiers ; il y en a N au total ». L information
    // voyage DANS content pour survivre a l INSERT et au renvoi (l e-mail
    // recompose depuis content). Le champ n existe que quand il est
    // load-bearing — un brief non tronque n a pas la ligne.
    if (content && typeof content === 'object') {
      if (totalMeetings > MORNING_BRIEF_MAX_MEETINGS) {
        (content as Record<string, unknown>).total_meetings_today = totalMeetings
      }
      // Lot « longueur » — POSER TOUJOURS meetings_expected (le nombre
      // demande au modele). C'est le caractere systematique qui rend le
      // manque detectable au rendu (canal 1 : modele qui rend N-k dossiers
      // sur N demandes) et cote cron (compteur meetings_dropped).
      (content as Record<string, unknown>).meetings_expected = meetingsForPrompt.length
    }

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
    // Meme raison qu au Mode B : un appel avorte etait facture, non trace.
    void logAiCall({
      source:        'morning_brief',
      workspace_id:  workspaceId,
      model:         'claude-sonnet-4-6',
      input_tokens:  0,
      output_tokens: 0,
      metadata:      { mode: 'A', failed: true, detail },
    })
    return { ok: false, reason: 'ai_unavailable', detail }
  }

  const text = msgA.content[0].type === 'text' ? msgA.content[0].text : '{}'
  const raw  = extractJsonObject(text)

  let content: unknown
  try { content = JSON.parse(raw) }
  catch { return { ok: false, reason: 'ai_unparseable' } }

  return { ok: true, content, mode: 'A', briefDate: today }
}
