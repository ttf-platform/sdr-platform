import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateDraftsForCampaign } from '@/lib/draft-generation'
import { rateLimitByWorkspace } from '@/lib/rate-limit'
import { campaignGenerateDraftsSchema, badRequest } from '@/lib/schemas'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const rl = await rateLimitByWorkspace(guard.workspaceId, { limit: 10, window: '1 m', prefix: 'llm-generate-drafts' })
  if (!rl.allowed) return rl.response

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = campaignGenerateDraftsSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { mode, include_booking_link_initial } = parsed.data

  if (typeof include_booking_link_initial === 'boolean') {
    const admin = createAdminClient()
    await admin.from('campaigns')
      .update({ include_booking_link_initial })
      .eq('id', params.id)
      .eq('workspace_id', guard.workspaceId)
  }

  const result = await generateDraftsForCampaign(params.id, guard.workspaceId, mode)

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json(result, { status: 201 })
}
