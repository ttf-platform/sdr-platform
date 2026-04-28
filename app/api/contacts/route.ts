import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

const STATUS_PRIORITY: Record<string, number> = {
  meeting: 4, replied: 3, opened: 2, emailed: 1, found: 0,
}

export async function GET(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const { searchParams } = new URL(request.url)
  const admin = createAdminClient()

  const campaign_id = searchParams.get('campaign_id')
  const status      = searchParams.get('status')
  const source      = searchParams.get('source')
  const search      = searchParams.get('search')
  const sort        = searchParams.get('sort') ?? 'newest'
  const page        = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit       = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')))
  const offset      = (page - 1) * limit

  // If assignment filters are set, resolve matching contact IDs from prospects table first
  let contactIds: string[] | null = null
  if (campaign_id || status || source) {
    let q = admin
      .from('prospects')
      .select('contact_id')
      .eq('workspace_id', guard.workspaceId)

    if (campaign_id) q = q.eq('campaign_id', campaign_id)
    if (status)      q = q.in('status', status.split(',').map(s => s.trim()))
    if (source)      q = q.in('source', source.split(',').map(s => s.trim()))

    const { data: rows } = await q
    contactIds = [...new Set((rows ?? []).map(r => r.contact_id as string))]

    if (contactIds.length === 0) {
      return NextResponse.json({ contacts: [], total: 0, page, limit, pages: 0 })
    }
  }

  // Fetch contacts with embedded assignments (LEFT JOIN — includes contacts with no assignments)
  let contactQuery = admin
    .from('contacts')
    .select(
      '*, prospects!contact_id(campaign_id, status, source, added_at, last_activity_at, campaigns(id, name))',
      { count: 'exact' },
    )
    .eq('workspace_id', guard.workspaceId)

  if (contactIds) contactQuery = contactQuery.in('id', contactIds)

  if (search) {
    const q = search.replace(/'/g, "''")
    contactQuery = contactQuery.or(
      `email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,company.ilike.%${q}%`,
    )
  }

  const orderCol  = (sort === 'name' || sort === 'name_z') ? 'first_name' : 'added_at'
  const ascending = sort === 'oldest' || sort === 'name'

  const { data: rawContacts, count, error } = await contactQuery
    .order(orderCol, { ascending })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aggregate per-contact stats from embedded assignments in JS.
  // TODO Sprint 17: move to SQL aggregation (GROUP BY contact_id, MAX CASE WHEN status...)
  // if query latency becomes an issue at scale.
  const contacts = (rawContacts ?? []).map((c: any) => {
    const assignments: any[] = c.prospects ?? []
    const campaignIdSet = new Set(assignments.filter(a => a.campaign_id).map(a => a.campaign_id))

    let primary_status   = 'found'
    let bestPriority     = -1
    let last_activity_at: string | null = null

    for (const a of assignments) {
      const p = STATUS_PRIORITY[a.status] ?? 0
      if (p > bestPriority) { primary_status = a.status; bestPriority = p }
      if (a.last_activity_at && (!last_activity_at || a.last_activity_at > last_activity_at)) {
        last_activity_at = a.last_activity_at
      }
    }

    // Primary campaign: most recently added assignment
    const sorted = [...assignments]
      .filter(a => a.campaign_id)
      .sort((a, b) => ((b.added_at ?? '') > (a.added_at ?? '') ? 1 : -1))
    const latest = sorted[0]

    const { prospects: _p, ...contactFields } = c
    return {
      ...contactFields,
      campaigns_count:       campaignIdSet.size,
      primary_status,
      last_activity_at,
      primary_campaign_name: latest?.campaigns?.name  ?? null,
      primary_campaign_id:   latest?.campaign_id      ?? null,
    }
  })

  return NextResponse.json({
    contacts,
    total: count ?? 0,
    page,
    limit,
    pages: Math.ceil((count ?? 0) / limit),
  })
}
