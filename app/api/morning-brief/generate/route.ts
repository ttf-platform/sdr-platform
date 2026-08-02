import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { morningBriefGenerateSchema, badRequest } from '@/lib/schemas'
import { getAnthropicClient } from '@/lib/anthropic'
import { checkAiRateLimit } from '@/lib/ratelimit'
import { generateMorningBrief } from '@/lib/morning-brief'

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

  const result = await generateMorningBrief({ admin, client, workspaceId: workspace_id })

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
