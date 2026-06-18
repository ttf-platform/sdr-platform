import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { signalRunSchema, badRequest } from '@/lib/schemas'
import { checkAiRateLimit } from '@/lib/ratelimit'
import { scanSignalOnCampaign } from '@/lib/signal-scanner'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 300

type Params = { params: Promise<{ id: string }> }

// POST /api/signals/[id]/run
//
// Manual Run : validates auth + rate limits, then delegates to scanSignalOnCampaign helper.
// Body : { campaign_id, prospect_ids? }
// Returns : ScanResult { prospects_scanned, matches_found, duration_ms, status }
export async function POST(request: Request, { params }: Params) {
  const { id: signalId } = await params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const aiCheck = await checkAiRateLimit(guard.workspaceId)
  if (!aiCheck.allowed) {
    return NextResponse.json(
      { error: 'AI rate limit exceeded for this workspace. Try again in a moment.', remaining: aiCheck.remaining, retry_after_ms: aiCheck.resetMs },
      { status: 429, headers: { 'Retry-After': Math.ceil(aiCheck.resetMs / 1000).toString() } }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = signalRunSchema.safeParse(body)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { campaign_id } = parsed.data

  const admin = createAdminClient()
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id')
    .eq('id', campaign_id)
    .eq('workspace_id', guard.workspaceId)
    .maybeSingle()

  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  const result = await scanSignalOnCampaign({
    workspaceId: guard.workspaceId,
    signalId,
    campaignId: campaign_id,
    maxProspects: 30,
  })

  if (result.status === 'failed') {
    return NextResponse.json({ error: result.error ?? 'Scan failed' }, { status: 400 })
  }

  return NextResponse.json(result)
}
