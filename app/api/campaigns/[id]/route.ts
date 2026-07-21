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
    return NextResponse.json({ error: 'Failed to delete campaign' }, { status: 500 })
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

  // ICP guard : ces champs alimentent lib/draft-generation.ts. Une fois que
  // le premier lot de drafts a été généré, changer l'ICP créerait une
  // incohérence entre le ciblage affiché et les emails déjà rédigés.
  // Verrou serveur (défense-en-profondeur ; l'UI cache le bouton Éditer,
  // mais un PATCH direct doit être refusé). On ne bloque QUE les champs ICP.
  // Les autres colonnes (name/angle/value_prop/cta/status/booking toggles…)
  // restent modifiables.
  const ICP_FIELDS = [
    'target_industry','target_titles','target_regions',
    'company_sizes','company_revenue','tone','language',
  ] as const
  const touchesIcp = ICP_FIELDS.some(k => k in updates)
  if (touchesIcp) {
    // Vérifie l'existence du step_order=0 de cette campagne (workspace-scopé
    // via la campagne lookup ci-dessous) puis count des prospect_emails.
    // Aucun input user ne pilote la query — l'IDOR est fermé par le double
    // .eq('workspace_id', guard.workspaceId).
    const { data: campaignRow } = await admin
      .from('campaigns')
      .select('id')
      .eq('id', params.id)
      .eq('workspace_id', guard.workspaceId)
      .maybeSingle()
    if (!campaignRow) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const { data: step } = await admin
      .from('campaign_steps')
      .select('id')
      .eq('campaign_id', params.id)
      .eq('step_order', 0)
      .maybeSingle()

    if (step) {
      const { count: draftsCount } = await admin
        .from('prospect_emails')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', guard.workspaceId)
        .eq('campaign_step_id', step.id)
      if ((draftsCount ?? 0) > 0) {
        return NextResponse.json({ error: 'icp_locked' }, { status: 409 })
      }
    }
  }

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
