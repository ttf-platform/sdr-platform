import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

const STATUS_PRIORITY: Record<string, number> = {
  meeting: 4, replied: 3, opened: 2, emailed: 1, found: 0,
}

const ALL_STATUSES = ['found', 'emailed', 'opened', 'replied', 'meeting', 'bounced', 'unsubscribed'] as const

function computeFilterCounts(rows: { contact_id: string; status: string }[]) {
  // Count total assignments per status (not distinct contacts)
  const counts: Record<string, number> = {}
  for (const s of ALL_STATUSES) counts[s] = 0
  for (const row of rows) {
    if (row.status in counts) counts[row.status]++
  }
  return counts
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
  const tag_ids     = (searchParams.get('tag_ids') ?? '').split(',').map(s => s.trim()).filter(Boolean)

  // Resolve contactIds (if assignment filters active) and filter_counts in parallel
  let filterCountsRows: { contact_id: string; status: string }[] = []
  let contactIds: string[] | null = null

  const countsQuery = admin
    .from('prospects')
    .select('contact_id, status')
    .eq('workspace_id', guard.workspaceId)

  if (campaign_id || status || source || tag_ids.length > 0) {
    let q = admin
      .from('prospects')
      .select('contact_id')
      .eq('workspace_id', guard.workspaceId)

    if (campaign_id) q = q.eq('campaign_id', campaign_id)
    if (status)      q = q.in('status', status.split(',').map(s => s.trim()))
    if (source)      q = q.in('source', source.split(',').map(s => s.trim()))

    const countsPromise = countsQuery
    let taggedContactIds: string[] | null = null

    if (tag_ids.length > 0) {
      const { data: taggedRows } = await admin
        .from('prospect_tag_assignments')
        .select('prospect_id')
        .in('tag_id', tag_ids)

      const taggedProspectIds = (taggedRows ?? []).map((r: any) => r.prospect_id as string)

      if (taggedProspectIds.length > 0) {
        const { data: taggedProspects } = await admin
          .from('prospects')
          .select('contact_id')
          .in('id', taggedProspectIds)
          .eq('workspace_id', guard.workspaceId)
        taggedContactIds = [...new Set((taggedProspects ?? []).map((r: any) => r.contact_id as string))]
      } else {
        taggedContactIds = []
      }
    }

    const [{ data: filterRows }, { data: countsRows }] = await Promise.all([q, countsPromise])

    filterCountsRows = countsRows ?? []
    let ids = [...new Set((filterRows ?? []).map(r => r.contact_id as string))]

    if (taggedContactIds !== null) {
      const tagSet = new Set(taggedContactIds)
      ids = ids.filter(id => tagSet.has(id))
    }

    contactIds = ids

    if (contactIds.length === 0) {
      const filter_counts = computeFilterCounts(filterCountsRows)
      const total_all = new Set(filterCountsRows.map(r => r.contact_id)).size
      return NextResponse.json({ contacts: [], total: 0, page, limit, pages: 0, filter_counts, total_all })
    }
  } else {
    const { data: countsRows } = await countsQuery
    filterCountsRows = countsRows ?? []
  }

  const filter_counts = computeFilterCounts(filterCountsRows)
  const total_all = new Set(filterCountsRows.map(r => r.contact_id)).size

  // Fetch contacts with embedded assignments (LEFT JOIN)
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

  // Fetch tags for all returned contacts (via their prospect assignments)
  const returnedContactIds = (rawContacts ?? []).map((c: any) => c.id as string)
  let tagsPerContact: Record<string, { id: string; label: string; color: string }[]> = {}

  if (returnedContactIds.length > 0) {
    const { data: tagRows } = await admin
      .from('prospects')
      .select('contact_id, prospect_tag_assignments(tag_id, prospect_tags(id, label, color))')
      .in('contact_id', returnedContactIds)
      .eq('workspace_id', guard.workspaceId)

    for (const row of (tagRows ?? []) as any[]) {
      const cid = row.contact_id as string
      if (!tagsPerContact[cid]) tagsPerContact[cid] = []
      for (const assignment of (row.prospect_tag_assignments ?? [])) {
        const tag = assignment.prospect_tags
        if (tag && !tagsPerContact[cid].some((t: any) => t.id === tag.id)) {
          tagsPerContact[cid].push(tag)
        }
      }
    }
  }

  // Aggregate per-contact stats from embedded assignments in JS.
  // TODO Sprint 17: move to SQL aggregation (GROUP BY contact_id, MAX CASE WHEN status...)
  // if query latency becomes an issue at scale.
  const contacts = (rawContacts ?? []).map((c: any) => {
    const assignments: any[] = (c.prospects ?? []).filter((a: any) => a.campaign_id)
    const campaignIdSet = new Set(assignments.map(a => a.campaign_id))

    let primary_status   = 'found'
    let bestPriority     = -1
    let last_activity_at: string | null = null

    const lifecycle_counts: Record<string, number> = {
      found: 0, emailed: 0, opened: 0, replied: 0, meeting: 0, bounced: 0, unsubscribed: 0,
    }

    for (const a of assignments) {
      const p = STATUS_PRIORITY[a.status] ?? 0
      if (p > bestPriority) { primary_status = a.status; bestPriority = p }
      if (a.last_activity_at && (!last_activity_at || a.last_activity_at > last_activity_at)) {
        last_activity_at = a.last_activity_at
      }
      if (a.status in lifecycle_counts) lifecycle_counts[a.status]++
    }

    const sorted = [...assignments].sort((a, b) => ((b.added_at ?? '') > (a.added_at ?? '') ? 1 : -1))
    const latest = sorted[0]

    const { prospects: _p, ...contactFields } = c
    return {
      ...contactFields,
      campaigns_count:       campaignIdSet.size,
      lifecycle_counts,
      primary_status,
      last_activity_at,
      primary_campaign_name: latest?.campaigns?.name ?? null,
      primary_campaign_id:   latest?.campaign_id     ?? null,
      primary_source:        latest?.source          ?? null,
      tags:                  tagsPerContact[c.id]    ?? [],
    }
  })

  return NextResponse.json({
    contacts,
    total: count ?? 0,
    total_all,
    filter_counts,
    page,
    limit,
    pages: Math.ceil((count ?? 0) / limit),
  })
}
