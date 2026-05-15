import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateDraftsForCampaign } from '@/lib/draft-generation'
import { rateLimitByWorkspace } from '@/lib/rate-limit'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const rl = await rateLimitByWorkspace(guard.workspaceId, { limit: 10, window: '1 m', prefix: 'llm-generate-drafts' })
  if (!rl.allowed) return rl.response

  const body = await request.json()
  const { mode, include_booking_link_initial } = body

  if (!['fast', 'smart'].includes(mode)) {
    return NextResponse.json({ error: 'mode must be "fast" or "smart"' }, { status: 400 })
  }

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
