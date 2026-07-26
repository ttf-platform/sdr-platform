import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { assertIcpConfigured } from '@/lib/require-icp'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateDraftsForCampaign } from '@/lib/draft-generation'
import { rateLimitByWorkspace } from '@/lib/rate-limit'
import { campaignRegenerateDraftsSchema, badRequest } from '@/lib/schemas'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const icp = await assertIcpConfigured(guard.workspaceId)
  if (icp.blocked) return icp.response

  const rl = await rateLimitByWorkspace(guard.workspaceId, { limit: 10, window: '1 m', prefix: 'llm-regenerate-drafts' })
  if (!rl.allowed) return rl.response

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = campaignRegenerateDraftsSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { mode, include_booking_link_initial } = parsed.data

  const admin = createAdminClient()

  if (typeof include_booking_link_initial === 'boolean') {
    await admin.from('campaigns')
      .update({ include_booking_link_initial })
      .eq('id', params.id)
      .eq('workspace_id', guard.workspaceId)
  }

  // Verify ownership
  const { data: campaign } = await admin
    .from('campaigns').select('id').eq('id', params.id).eq('workspace_id', guard.workspaceId).single()

  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  // Delete only step-0 (initial email) drafts — follow-ups are not pre-generated.
  //
  // Statuses cleared : draft / edited / rejected.
  //   - 'draft' + 'edited' : never-approved AI output, safe to redo.
  //   - 'rejected'         : user actively declined, safe to redo (a later
  //                          undo could only bring it back to draft, so
  //                          re-generating on top is the same net effect).
  //
  // Statuses PRESERVED (positive list, not a negation, so the intent is
  // explicit and cannot silently include a future new status) :
  //   - 'approved'                    → user validated this email, awaiting
  //                                     send. Destroying it silently would
  //                                     be the same double-send-class bug
  //                                     as re-editing a committed row.
  //   - 'sending' / 'sent' /
  //     'bounced' / 'replied'         → COMMITTED_STATUSES per
  //                                     lib/prospect-email-status.ts. The
  //                                     row carries provider_message_id +
  //                                     thread_id ; destroying it orphans
  //                                     provider webhooks and loses history.
  //   - 'failed'                      → last approve raised an enqueue error ;
  //                                     the row is the audit trail. Keep it
  //                                     until the operator explicitly clears.
  //
  // draft-generation.ts:251-309 pre-fetches existing (prospect_id,
  // campaign_step_id) pairs and SKIPS them before building work items, so
  // preserved rows do NOT trigger the UNIQUE(prospect_id, campaign_step_id)
  // constraint from migration 014 — the pair simply gets skipped from
  // regeneration and the response reports it via `skipped_existing`.
  const { data: initialStep } = await admin
    .from('campaign_steps')
    .select('id')
    .eq('campaign_id', params.id)
    .eq('step_order', 0)
    .single()

  if (initialStep) {
    await admin
      .from('prospect_emails')
      .delete()
      .eq('workspace_id', guard.workspaceId)
      .eq('campaign_step_id', initialStep.id)
      .in('status', ['draft', 'edited', 'rejected'])
  }

  const result = await generateDraftsForCampaign(params.id, guard.workspaceId, mode)

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json(result, { status: 201 })
}
