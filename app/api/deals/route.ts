import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { dealCreateSchema, badRequest } from '@/lib/schemas'

function flattenDeal(raw: any) {
  const contact = raw.prospects?.contacts ?? {}
  return {
    id:               raw.id,
    stage:            raw.stage,
    amount:           raw.amount,
    currency:         raw.currency,
    closed_reason:    raw.closed_reason,
    notes:            raw.notes,
    source:           raw.source,
    stage_changed_at: raw.stage_changed_at,
    created_at:       raw.created_at,
    closed_at:        raw.closed_at,
    prospect_id:      raw.prospect_id,
    campaign_id:      raw.campaign_id,
    contact_first_name: contact.first_name  ?? null,
    contact_last_name:  contact.last_name   ?? null,
    contact_company:    contact.company     ?? null,
    contact_title:      contact.title       ?? null,
    contact_email:      contact.email       ?? null,
    contact_linkedin:   contact.linkedin_url ?? null,
    campaign_name:      raw.campaigns?.name ?? null,
  }
}

export async function GET() {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('deals')
    .select(`
      id, stage, amount, currency, closed_reason, notes, source,
      stage_changed_at, created_at, closed_at, prospect_id, campaign_id,
      prospects!prospect_id( id, contacts!contact_id(first_name, last_name, company, title, email, linkedin_url) ),
      campaigns!campaign_id( id, name )
    `)
    .eq('workspace_id', guard.workspaceId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deals: (data ?? []).map(flattenDeal) })
}

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = dealCreateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { contact_id, stage = 'new_lead', amount, notes } = parsed.data

  const admin = createAdminClient()

  // Find the most recent prospect assignment for this contact
  const { data: prospect } = await admin
    .from('prospects')
    .select('id, campaign_id')
    .eq('contact_id', contact_id)
    .eq('workspace_id', guard.workspaceId)
    .order('added_at', { ascending: false })
    .limit(1)
    .single()

  if (!prospect) {
    return NextResponse.json({ error: 'Contact has no campaign assignments — add them to a campaign first' }, { status: 404 })
  }

  // Check for duplicate
  const { data: existing } = await admin
    .from('deals')
    .select('id')
    .eq('prospect_id', prospect.id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'A deal already exists for this prospect' }, { status: 409 })
  }

  const { data: deal, error } = await admin
    .from('deals')
    .insert({
      workspace_id: guard.workspaceId,
      prospect_id:  prospect.id,
      campaign_id:  prospect.campaign_id,
      source:       'manual',
      stage,
      amount:       amount ?? null,
      notes:        notes  ?? null,
    })
    .select(`
      id, stage, amount, currency, closed_reason, notes, source,
      stage_changed_at, created_at, closed_at, prospect_id, campaign_id,
      prospects!prospect_id( id, contacts!contact_id(first_name, last_name, company, title, email, linkedin_url) ),
      campaigns!campaign_id( id, name )
    `)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deal: flattenDeal(deal) }, { status: 201 })
}
