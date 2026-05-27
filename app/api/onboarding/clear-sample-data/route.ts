import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function DELETE() {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { workspaceId } = guard

  // Delete in FK order: children before parents
  await admin.from('prospect_email_variants').delete().eq('workspace_id', workspaceId).eq('is_sample', true)
  await admin.from('prospect_emails').delete().eq('workspace_id', workspaceId).eq('is_sample', true)
  await admin.from('prospects').delete().eq('workspace_id', workspaceId).eq('is_sample', true)
  await admin.from('contacts').delete().eq('workspace_id', workspaceId).eq('is_sample', true)
  // campaign_steps has no workspace_id column; filter by is_sample only
  await admin.from('campaign_steps').delete().eq('is_sample', true)
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
