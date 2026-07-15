import { NextResponse } from 'next/server'
import { z } from 'zod'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { badRequest } from '@/lib/schemas'

export const runtime = 'nodejs'

const enrollSchema = z.object({
  contact_ids: z.array(z.string().uuid()).min(1).max(500),
})

// POST /api/campaigns/[id]/prospects
// Enroll existing contacts into a campaign.
// Guards: campaign belongs to workspace, all contact_ids belong to workspace,
// dedup against UNIQUE(contact_id, campaign_id).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const campaignId = params.id

  // 1. Campaign scoping — verify it belongs to this workspace.
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, prospects_count')
    .eq('id', campaignId)
    .eq('workspace_id', guard.workspaceId)
    .single()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  // 2. Body parse.
  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = enrollSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { contact_ids } = parsed.data
  const uniqueIds = [...new Set(contact_ids)]

  // 3. Validate all contact_ids belong to this workspace — reject any foreign id.
  const { data: contactsData, error: contactsErr } = await admin
    .from('contacts')
    .select('id, email')
    .in('id', uniqueIds)
    .eq('workspace_id', guard.workspaceId)
  if (contactsErr) return NextResponse.json({ error: contactsErr.message }, { status: 500 })
  const contactsMap = new Map((contactsData ?? []).map(c => [c.id, c.email as string]))
  if (contactsMap.size !== uniqueIds.length) {
    return NextResponse.json({ error: 'One or more contacts not found in workspace' }, { status: 400 })
  }

  // 4. Dedup against existing prospects for this campaign.
  const { data: existing } = await admin
    .from('prospects')
    .select('contact_id')
    .eq('campaign_id', campaignId)
    .eq('workspace_id', guard.workspaceId)
    .in('contact_id', uniqueIds)
  const existingSet = new Set((existing ?? []).map(r => r.contact_id as string))

  const newAssignments = uniqueIds
    .filter(id => !existingSet.has(id))
    .map(id => ({
      workspace_id: guard.workspaceId,
      campaign_id:  campaignId,
      contact_id:   id,
      email:        contactsMap.get(id)!,
      source:       'manual',
      status:       'found',
    }))

  if (newAssignments.length > 0) {
    const { error: insertErr } = await admin.from('prospects').insert(newAssignments)
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

    // Best-effort counter bump. Reads recompute from COUNT(*), so drift is self-healing.
    await admin
      .from('campaigns')
      .update({ prospects_count: (campaign.prospects_count ?? 0) + newAssignments.length })
      .eq('id', campaignId)
      .eq('workspace_id', guard.workspaceId)
  }

  return NextResponse.json({
    enrolled:      newAssignments.length,
    skipped_dedup: uniqueIds.length - newAssignments.length,
  })
}
