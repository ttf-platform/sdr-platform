import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { morningBriefGenerateSchema, badRequest } from '@/lib/schemas'
import { getAnthropicClient } from '@/lib/anthropic'
import { checkAiRateLimit } from '@/lib/ratelimit'
import { generateMorningBrief } from '@/lib/morning-brief'

export const maxDuration = 60

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
    // reason === 'ai_unparseable'
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
