import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/prospects
//
// Standard list mode (pagination + filters):
//   ?campaign_id=X
//   &status=found,emailed          (comma-separated, OR logic)
//   &source=csv_import,manual      (comma-separated, OR logic)
//   &search=text                   (matches email, first_name, last_name, company)
//   &page=1&limit=50
//
// Cross-campaign warning lookup mode (for CSV import modal):
//   ?emails=a@b.com,c@d.com&exclude_campaign=X
//   Returns { matches: [{ email, campaign_id, campaigns: { name } }] }
//   Used to warn user if emails already exist in other active campaigns.

export async function GET(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const { searchParams } = new URL(request.url)
  const admin = createAdminClient()

  // ── Cross-campaign lookup mode ───────────────────────────────────────────────
  const emailsParam = searchParams.get('emails')
  if (emailsParam) {
    const emailList = emailsParam.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    const excludeCampaign = searchParams.get('exclude_campaign')

    let query = admin
      .from('prospects')
      .select('email, campaign_id, campaigns(name)')
      .eq('workspace_id', guard.workspaceId)
      .in('email', emailList)

    if (excludeCampaign) query = query.neq('campaign_id', excludeCampaign)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ matches: data ?? [] })
  }

  // ── Standard list mode ───────────────────────────────────────────────────────
  const campaign_id = searchParams.get('campaign_id')
  const status      = searchParams.get('status')   // comma-separated
  const source      = searchParams.get('source')   // comma-separated
  const search      = searchParams.get('search')
  const sort        = searchParams.get('sort') ?? 'newest'
  const page        = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit       = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')))
  const offset      = (page - 1) * limit

  let query = admin
    .from('prospects')
    .select('*, campaigns(id, name)', { count: 'exact' })
    .eq('workspace_id', guard.workspaceId)

  if (campaign_id) query = query.eq('campaign_id', campaign_id)
  if (status)      query = query.in('status', status.split(',').map(s => s.trim()))
  if (source)      query = query.in('source', source.split(',').map(s => s.trim()))
  if (search) {
    const q = search.replace(/'/g, "''") // basic sanitize for ilike
    query = query.or(
      `email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,company.ilike.%${q}%`,
    )
  }

  const orderCol  = (sort === 'name' || sort === 'name_z') ? 'first_name' : 'added_at'
  const ascending = sort === 'oldest' || sort === 'name'

  const { data: prospects, count, error } = await query
    .order(orderCol, { ascending })
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
