import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { campaignUpdateSchema, badRequest } from '@/lib/schemas'

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('*')
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (error || !campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const [{ data: steps }, { count: prospectsCount }] = await Promise.all([
    admin.from('campaign_steps')
      .select('*')
      .eq('campaign_id', params.id)
      .order('step_order', { ascending: true }),
    admin.from('prospects')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', params.id)
      .eq('workspace_id', guard.workspaceId),
  ])

  const initialStep = (steps ?? []).find(s => s.step_order === 0)
  let drafts_count = 0
  const by_status: Record<string, number> = {}

  if (initialStep) {
    const { data: emailRows } = await admin
      .from('prospect_emails')
      .select('status')
      .eq('workspace_id', guard.workspaceId)
      .eq('campaign_step_id', initialStep.id)

    for (const row of emailRows ?? []) {
      by_status[row.status] = (by_status[row.status] ?? 0) + 1
      drafts_count++
    }
  }

  const stepIds = (steps ?? []).map(s => s.id)
  let pending_drafts_count = 0
  if (stepIds.length > 0) {
    const { count } = await admin
      .from('prospect_email_variants')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', guard.workspaceId)
      .in('campaign_step_id', stepIds)
      .in('status', ['draft', 'edited'])
    pending_drafts_count = count ?? 0
  }

  return NextResponse.json({
    campaign: { ...campaign, prospects_count: prospectsCount ?? 0, drafts_count, pending_drafts_count, by_status },
    steps: steps ?? [],
  })
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { error } = await admin
    .from('campaigns')
    .delete()
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)

  if (error) {
    console.error('[DELETE campaign]', error)
    return NextResponse.json({
      error:         'delete_failed',
      debug_message: error.message,
      debug_code:    (error as any).code,
      debug_details: (error as any).details,
      debug_hint:    (error as any).hint,
    }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const parsed = campaignUpdateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)

  const {
    name, angle, value_prop, cta, target_persona, proof_points,
    target_industry, target_titles, target_regions,
    company_sizes, company_revenue, tone, language,
    status, smart_stop_on_reply, smart_stop_on_bounce,
    booking_link_in_followups, include_booking_link_initial,
  } = parsed.data

  const updates: Record<string, unknown> = {}
  if (name             !== undefined) updates.name             = name
  if (angle            !== undefined) updates.angle            = angle
  if (value_prop       !== undefined) updates.value_prop       = value_prop
  if (cta              !== undefined) updates.cta              = cta
  if (target_persona   !== undefined) updates.target_persona   = target_persona
  if (proof_points     !== undefined) updates.proof_points     = proof_points
  if (target_industry  !== undefined) updates.target_industry  = target_industry
  if (target_titles    !== undefined) updates.target_titles    = target_titles
  if (target_regions   !== undefined) updates.target_regions   = target_regions
  if (company_sizes    !== undefined) updates.company_sizes    = company_sizes
  if (company_revenue  !== undefined) updates.company_revenue  = company_revenue
  if (tone             !== undefined) updates.tone             = tone
  if (language         !== undefined) updates.language         = language
  if (status           !== undefined) updates.status           = status
  if (smart_stop_on_reply    !== undefined) updates.smart_stop_on_reply    = smart_stop_on_reply
  if (smart_stop_on_bounce   !== undefined) updates.smart_stop_on_bounce   = smart_stop_on_bounce
  if (booking_link_in_followups    !== undefined) updates.booking_link_in_followups    = booking_link_in_followups
  if (include_booking_link_initial !== undefined) updates.include_booking_link_initial = include_booking_link_initial

  const admin = createAdminClient()
  const { data: campaign, error } = await admin
    .from('campaigns')
    .update(updates)
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ campaign })
}
