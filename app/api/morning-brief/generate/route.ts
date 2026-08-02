import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { morningBriefGenerateSchema, badRequest } from '@/lib/schemas'
import { getAnthropicClient } from '@/lib/anthropic'
import { checkAiRateLimit } from '@/lib/ratelimit'
import { generateMorningBrief } from '@/lib/morning-brief'
import { decideRegen } from '@/lib/morning-brief-regen'
import { todayBoundsUTC } from '@/lib/local-day'

// Lot 5c-0 : le Mode B genere jusqu a 8 000 tokens (12 rendez-vous, pire cas
// mesure ~6 150), timeout par appel a 240 s. Un maxDuration a 60 s tuerait
// la fonction avant l ecriture — le repo utilise deja 300 s pour les crons
// lourds (auto-scan-signals, reputation-snapshot).
export const maxDuration = 300

export async function POST(request: Request) {
  // ⚠️ getAnthropicClient() reste appelé AVANT billingGuard, comme historiquement :
  // sur une instance mal configurée (ANTHROPIC_API_KEY absente) il jette, et une
  // requête non authentifiée produit alors un 500 avant le 401. Le déplacer après
  // les gardes changerait cet ordre — amélioration, mais delta observable non
  // couvert par le contrat « comportement constant » du lot 2 (Morning Brief).
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

  // Lot 5b-bis §1.4 : la route RECALCULE la decision cote serveur avec le
  // meme module pur qu'utilise le client. On IGNORE explicitement tout
  // `kind` present dans le corps (le schema Zod ne le declare pas mais
  // n'est pas .strict()) — le client peut mentir, et un appel modele force
  // est paye.
  const [{ data: wp }, { data: allBriefs }] = await Promise.all([
    admin.from('workspace_profiles').select('booking_config').eq('workspace_id', workspace_id).single(),
    admin.from('morning_briefs').select('created_at, source, emailed_at, brief_date').eq('workspace_id', workspace_id).order('brief_date', { ascending: false }).order('created_at', { ascending: false }),
  ])
  const tz = (wp?.booking_config as { timezone?: string } | null)?.timezone ?? 'UTC'
  let bounds: { start: Date; end: Date; dateStr: string }
  try   { bounds = todayBoundsUTC(tz) }
  catch { bounds = todayBoundsUTC('UTC') }

  const briefs = allBriefs ?? []
  const everReceivedBrief = briefs.length > 0
  const todayBriefs = briefs.filter(b => b.brief_date === bounds.dateStr)
  const todayCron = todayBriefs.find(b => b.source === 'cron')
  const todayLatest = todayBriefs[0] // tri decroissant sur created_at → le plus recent
  const todayCronEmailedAt = (todayCron?.emailed_at as string | null | undefined) ?? null
  const todayBriefCreatedAt = (todayLatest?.created_at as string | null | undefined) ?? null

  const { data: todayMeetings } = await admin
    .from('meetings')
    .select('created_at, confirmed_at')
    .eq('workspace_id', workspace_id)
    .eq('status', 'scheduled')
    .gte('meeting_at', bounds.start.toISOString())
    .lte('meeting_at', bounds.end.toISOString())

  const decision = decideRegen({
    everReceivedBrief,
    todayCronEmailedAt,
    todayBriefCreatedAt,
    todayMeetings: (todayMeetings ?? []).map(m => ({
      createdAt:   m.created_at as string,
      confirmedAt: (m.confirmed_at as string | null | undefined) ?? null,
    })),
  })

  if (!decision.enabled) {
    // 409 (code deja employe dans le repo, app/api/prospect-emails/**) :
    // ni erreur du client, ni erreur serveur, mais etat qui empeche l'action
    // ici-maintenant. AUCUN appel modele fait.
    return NextResponse.json(
      { error: 'No new meetings to prepare. Come back after booking a new one today.' },
      { status: 409 }
    )
  }

  const result = await generateMorningBrief({
    admin,
    client,
    workspaceId: workspace_id,
    kind: decision.kind, // 'full' ou 'meetings_only', decide cote serveur.
  })

  if (!result.ok) {
    if (result.reason === 'profile_score_too_low') {
      return NextResponse.json(
        { error: 'Complete your profile to generate a brief (AI quality score must reach 30+).' },
        { status: 400 }
      )
    }
    if (result.reason === 'ai_unavailable') {
      return NextResponse.json(
        { error: 'AI service temporarily unavailable. Please try again in a moment.' },
        { status: 503 }
      )
    }
    if (result.reason === 'ai_truncated') {
      // Lot 5c-0 : distinct de 'ai_unparseable' (contenu illisible) et de
      // 'ai_unavailable' (appel echoue). Message generique — cette branche
      // est quasi inatteignable apres le plafond de 12 rendez-vous + le
      // max_tokens de 8000, c est un filet de diagnostic.
      return NextResponse.json(
        { error: 'AI response was cut short. Please try again in a moment.' },
        { status: 500 }
      )
    }
    if (result.reason === 'no_meetings_for_prep') {
      // Lot 5b-bis : etat impossible en pratique (le predicat serveur
      // ci-dessus verifie qu'il y a des rendez-vous avant d'appeler avec
      // kind='meetings_only'). Trace explicitement plutot que de retomber
      // silencieusement sur ai_unparseable.
      return NextResponse.json(
        { error: 'No meetings found for prep. Please refresh and try again.' },
        { status: 409 }
      )
    }
    // reason === 'ai_unparseable' — derniere branche, exhaustive.
    return NextResponse.json(
      { error: 'Failed to parse AI response. Please try again.' },
      { status: 500 }
    )
  }

  const { data: brief, error } = await admin
    .from('morning_briefs')
    .insert({ workspace_id, content: result.content, brief_date: result.briefDate, sent_at: new Date().toISOString() })
    .select().single()

  if (error || !brief) return NextResponse.json({ error: 'Failed to save brief' }, { status: 500 })
  return NextResponse.json({ brief })
}
