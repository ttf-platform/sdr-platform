import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { prospectUpdateSchema, badRequest } from '@/lib/schemas'

// Patchable fields on the prospect (assignment) row.
// Identity fields live on contacts — patch via /api/contacts/[id].
// campaign_id excluded: moving a prospect to another campaign risks UNIQUE(contact_id, campaign_id)
// violation with no clean 409 path. TODO Sprint 17: dedicated /api/prospects/[id]/move-to-campaign.
const PATCHABLE = ['status'] as const

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { data: prospect, error } = await admin
    .from('prospects')
    .select('*, contacts!contact_id(first_name, last_name, company, title, linkedin_url, website), campaigns(id, name)')
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (error || !prospect) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
  return NextResponse.json({ prospect })
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const parsed = prospectUpdateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)

  const body = parsed.data
  const updates: Record<string, unknown> = {}
  for (const key of PATCHABLE) {
    if (key in body) updates[key] = body[key as keyof typeof body]
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: prospect, error } = await admin
    .from('prospects')
    .update(updates)
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-create deal when prospect reaches 'replied' stage
  if (body.status === 'replied') {
    const { data: existing } = await admin
      .from('deals')
      .select('id')
      .eq('prospect_id', params.id)
      .maybeSingle()

    if (!existing) {
      await admin.from('deals').insert({
        workspace_id: guard.workspaceId,
        prospect_id:  params.id,
        campaign_id:  prospect.campaign_id ?? null,
        source:       'campaign_reply',
        stage:        'replied',
      })
    }
  }

  return NextResponse.json({ prospect })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  // Deletes the campaign assignment only — the contact record is preserved.
  const { error } = await admin
    .from('prospects')
    .delete()
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
