import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { prospectsListQuerySchema, prospectsListByEmailsQuerySchema, badRequest } from '@/lib/schemas'

// GET /api/prospects
//
// Campaign-assignment list (always scoped by campaign_id):
//   ?campaign_id=X                    (required for meaningful use — returns all workspace prospects if omitted)
//   &status=found,emailed             (comma-separated, OR logic)
//   &source=csv_import,manual         (comma-separated, OR logic)
//   &search=text                      (matches email on prospects + name/company via contacts subquery)
//   &page=1&limit=50
//
// Identity fields (first_name, last_name, company, title, linkedin_url, website)
// are joined from contacts via contact_id FK.
//
// Cross-campaign warning lookup mode (for CSV import modal):
//   ?emails=a@b.com,c@d.com&exclude_campaign=X
//   Returns { matches: [{ email, campaign_id, campaigns: { name } }] }

export async function GET(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const { searchParams } = new URL(request.url)
  const admin = createAdminClient()
  const qp = Object.fromEntries(searchParams)

  // Cross-campaign lookup mode
  if (searchParams.has('emails')) {
    const emailsParsed = prospectsListByEmailsQuerySchema.safeParse(qp)
    if (!emailsParsed.success) return badRequest(emailsParsed.error.issues)
    const { emails, exclude_campaign, campaign_id: inCampaign } = emailsParsed.data

    let query = admin
      .from('prospects')
      .select('email, campaign_id, campaigns(name)')
      .eq('workspace_id', guard.workspaceId)
      .in('email', emails)

    if (exclude_campaign) query = query.neq('campaign_id', exclude_campaign)
    if (inCampaign)       query = query.eq('campaign_id', inCampaign)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ matches: data ?? [] })
  }

  // Standard list mode
  const listParsed = prospectsListQuerySchema.safeParse(qp)
  if (!listParsed.success) return badRequest(listParsed.error.issues)
  const { campaign_id, status, source, search, page, limit } = listParsed.data
  const sort   = listParsed.data.sort ?? 'newest'
  const offset = (page - 1) * limit

  let query = admin
    .from('prospects')
    .select(
      '*, contacts!contact_id(first_name, last_name, company, title, linkedin_url, website), campaigns(id, name)',
      { count: 'exact' },
    )
    .eq('workspace_id', guard.workspaceId)

  if (campaign_id) query = query.eq('campaign_id', campaign_id)
  if (status?.length) query = query.in('status', status)
  if (source?.length) query = query.in('source', source)

  if (search) {
    const q = search.replace(/'/g, "''")
    // email lives on prospects (denormalized) — search it directly.
    // name/company live on contacts — resolve matching contact_ids first.
    const { data: nameMatches } = await admin
      .from('contacts')
      .select('id')
      .eq('workspace_id', guard.workspaceId)
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,company.ilike.%${q}%`)

    const matchedIds = (nameMatches ?? []).map(c => c.id)

    if (matchedIds.length > 0) {
      query = query.or(`email.ilike.%${q}%,contact_id.in.(${matchedIds.join(',')})`)
    } else {
      query = query.ilike('email', `%${q}%`)
    }
  }

  // Sort by prospects.added_at only — name sort requires joining contacts order,
  // not supported in this endpoint (campaign tab does not use name sort).
  const ascending = sort === 'oldest'

  const { data: prospects, count, error } = await query
    .order('added_at', { ascending })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    prospects: prospects ?? [],
    total:     count ?? 0,
    page,
    limit,
    pages:     Math.ceil((count ?? 0) / limit),
  })
}
