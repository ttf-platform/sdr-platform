import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

type Params = { params: Promise<{ id: string }> }

// GET /api/campaigns/[id]/approval-queue
//
// Returns all prospect_email_variants for this campaign in 'draft' or 'edited' status,
// joined with prospect + contact + step info.
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id: campaignId } = await params
    const guard = await billingGuard()
    if (guard.blocked) return guard.response

    const admin = createAdminClient()

    // Verify campaign workspace
    const { data: campaign, error: campaignError } = await admin
      .from('campaigns')
      .select('id, name')
      .eq('id', campaignId)
      .eq('workspace_id', guard.workspaceId)
      .single()

    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    // Step 1: fetch raw variants (flat, no joins)
    const { data: rawVariants, error: variantsError } = await admin
      .from('prospect_email_variants')
      .select('id, prospect_id, campaign_step_id, subject, body, signal_ids, template_subject, template_body, status, edited_subject, edited_body, generated_at, approved_at')
      .eq('workspace_id', guard.workspaceId)
      .in('status', ['draft', 'edited'])
      .order('generated_at', { ascending: false })

    if (variantsError) {
      console.error('[approval-queue] variants fetch error:', variantsError)
      return NextResponse.json({ error: variantsError.message }, { status: 500 })
    }

    if (!rawVariants || rawVariants.length === 0) {
      return NextResponse.json({ variants: [], total: 0 })
    }

    const prospectIds = [...new Set(rawVariants.map(v => v.prospect_id))]
    const stepIds = [...new Set(rawVariants.map(v => v.campaign_step_id))]

    // Step 2: fetch prospects (filtered to this campaign + workspace)
    const { data: prospects, error: prospectsError } = await admin
      .from('prospects')
      .select('id, email, campaign_id, contacts!contact_id(first_name, last_name, company, title)')
      .in('id', prospectIds)
      .eq('campaign_id', campaignId)
      .eq('workspace_id', guard.workspaceId)

    if (prospectsError) {
      console.error('[approval-queue] prospects fetch error:', prospectsError)
      return NextResponse.json({ error: prospectsError.message }, { status: 500 })
    }

    // Step 3: fetch campaign steps
    const { data: steps, error: stepsError } = await admin
      .from('campaign_steps')
      .select('id, step_order, delay_days')
      .in('id', stepIds)

    if (stepsError) {
      console.error('[approval-queue] steps fetch error:', stepsError)
      return NextResponse.json({ error: stepsError.message }, { status: 500 })
    }

    const prospectMap = new Map((prospects ?? []).map(p => [p.id, p]))
    const stepMap = new Map((steps ?? []).map(s => [s.id, s]))

    // Only include variants whose prospect belongs to this campaign
    const variants = rawVariants
      .filter(v => prospectMap.has(v.prospect_id))
      .map(v => ({
        ...v,
        prospects: prospectMap.get(v.prospect_id) ?? null,
        campaign_steps: stepMap.get(v.campaign_step_id) ?? null,
      }))

    return NextResponse.json({ variants, total: variants.length })
  } catch (err) {
    console.error('[approval-queue] unexpected error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
