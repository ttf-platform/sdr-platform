import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const { searchParams } = new URL(request.url)
  const campaign_id    = searchParams.get('campaign_id')
  const step_order_raw = searchParams.get('step_order')
  const status_raw     = searchParams.get('status')
  const search         = searchParams.get('search')
  const page           = Math.max(1, parseInt(searchParams.get('page')  ?? '1'))
  const limit          = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')))
  const offset         = (page - 1) * limit

  if (!campaign_id) {
    return NextResponse.json({ error: 'campaign_id is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify campaign belongs to workspace
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, personalization_mode')
    .eq('id', campaign_id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  // Fetch steps to map campaign_step_id → step_order
  const { data: steps } = await admin
    .from('campaign_steps')
    .select('id, step_order')
    .eq('campaign_id', campaign_id)

  const allStepIds = (steps ?? []).map(s => s.id)
  if (allStepIds.length === 0) {
    return NextResponse.json({
      emails: [], total: 0, page, limit, pages: 0,
      by_step: {}, by_status: {},
      personalization_mode: campaign.personalization_mode,
    })
  }

  const stepOrderMap = new Map((steps ?? []).map(s => [s.id, s.step_order]))

  // Apply step_order filter
  let queryStepIds = allStepIds
  if (step_order_raw) {
    const orders = step_order_raw.split(',').map(n => parseInt(n.trim()))
    queryStepIds = (steps ?? []).filter(s => orders.includes(s.step_order)).map(s => s.id)
    if (queryStepIds.length === 0) {
      return NextResponse.json({
        emails: [], total: 0, page, limit, pages: 0,
        by_step: {}, by_status: {},
        personalization_mode: campaign.personalization_mode,
      })
    }
  }

  // Resolve search to prospect_ids (email on prospects + name/company on contacts)
  let prospectIdFilter: string[] | null = null
  if (search) {
    const q = search.replace(/'/g, "''")
    const [{ data: emailMatches }, { data: nameMatches }] = await Promise.all([
      admin.from('prospects').select('id').eq('workspace_id', guard.workspaceId).ilike('email', `%${q}%`),
      admin.from('contacts').select('id').eq('workspace_id', guard.workspaceId)
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,company.ilike.%${q}%`),
    ])

    let fromContacts: string[] = []
    const contactIds = (nameMatches ?? []).map(c => c.id)
    if (contactIds.length > 0) {
      const { data: cp } = await admin
        .from('prospects').select('id').eq('workspace_id', guard.workspaceId).in('contact_id', contactIds)
      fromContacts = (cp ?? []).map(p => p.id)
    }

    prospectIdFilter = [...new Set([...(emailMatches ?? []).map(p => p.id), ...fromContacts])]
    if (prospectIdFilter.length === 0) {
      return NextResponse.json({
        emails: [], total: 0, page, limit, pages: 0,
        by_step: {}, by_status: {},
        personalization_mode: campaign.personalization_mode,
      })
    }
  }

  // Main paginated query
  let q = admin
    .from('prospect_emails')
    .select(
      `*,
       campaign_steps!campaign_step_id(step_order, step_type, delay_days),
       prospects!prospect_id(
         email,
         contacts!contact_id(first_name, last_name, company, title)
       )`,
      { count: 'exact' },
    )
    .eq('workspace_id', guard.workspaceId)
    .in('campaign_step_id', queryStepIds)
    .order('generated_at', { ascending: false })

  if (status_raw) q = q.in('status', status_raw.split(',').map(s => s.trim()))
  if (prospectIdFilter) q = q.in('prospect_id', prospectIdFilter)

  const { data: rawEmails, count, error } = await q.range(offset, offset + limit - 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aggregate (campaign-wide, unfiltered) for by_step + by_status counters
  const { data: aggRows } = await admin
    .from('prospect_emails')
    .select('campaign_step_id, status')
    .eq('workspace_id', guard.workspaceId)
    .in('campaign_step_id', allStepIds)

  const by_step:   Record<string, number> = {}
  const by_status: Record<string, number> = {}
  for (const row of (aggRows ?? [])) {
    const order = stepOrderMap.get(row.campaign_step_id)
    if (order !== undefined) by_step[String(order)] = (by_step[String(order)] ?? 0) + 1
    by_status[row.status] = (by_status[row.status] ?? 0) + 1
  }

  // Shape response — flatten joined tables
  const emails = (rawEmails ?? []).map((e: any) => {
    const step    = e.campaign_steps ?? {}
    const prospect = e.prospects    ?? {}
    const contact  = prospect.contacts ?? {}
    const { campaign_steps: _s, prospects: _p, ...fields } = e
    return {
      ...fields,
      step_order: step.step_order ?? null,
      step_type:  step.step_type  ?? null,
      delay_days: step.delay_days ?? null,
      prospect: {
        id:         fields.prospect_id,
        email:      prospect.email      ?? null,
        first_name: contact.first_name  ?? null,
        last_name:  contact.last_name   ?? null,
        company:    contact.company     ?? null,
        title:      contact.title       ?? null,
      },
    }
  })

  return NextResponse.json({
    emails,
    total:  count ?? 0,
    page,
    limit,
    pages:  Math.ceil((count ?? 0) / limit),
    by_step,
    by_status,
    personalization_mode: campaign.personalization_mode,
  })
}
