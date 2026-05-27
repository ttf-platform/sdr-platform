import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function DELETE() {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { workspaceId } = guard

  // Fetch this workspace's sample campaign IDs first — used to scope
  // campaign_steps (which has no workspace_id column)
  const { data: sampleCampaigns } = await admin
    .from('campaigns')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('is_sample', true)

  const sampleCampaignIds = (sampleCampaigns ?? []).map(c => c.id)

  // Delete in FK order: children before parents
  await admin.from('prospect_email_variants').delete().eq('workspace_id', workspaceId).eq('is_sample', true)
  await admin.from('prospect_emails').delete().eq('workspace_id', workspaceId).eq('is_sample', true)
  await admin.from('prospects').delete().eq('workspace_id', workspaceId).eq('is_sample', true)
  await admin.from('contacts').delete().eq('workspace_id', workspaceId).eq('is_sample', true)
  // campaign_steps has no workspace_id; scope via campaign_id FK to this workspace's campaigns
  if (sampleCampaignIds.length > 0) {
    await admin.from('campaign_steps').delete().in('campaign_id', sampleCampaignIds).eq('is_sample', true)
  }
  await admin.from('campaigns').delete().eq('workspace_id', workspaceId).eq('is_sample', true)
  await admin.from('signals').delete().eq('workspace_id', workspaceId).eq('is_sample', true)

  // Reset try_mirvo_mode
  const { data: ws } = await admin
    .from('workspaces')
    .select('onboarding_state')
    .eq('id', workspaceId)
    .single()

  const currentState = (ws?.onboarding_state as Record<string, unknown>) ?? {}
  await admin
    .from('workspaces')
    .update({ onboarding_state: { ...currentState, try_mirvo_mode: false } })
    .eq('id', workspaceId)

  return NextResponse.json({ ok: true })
}
