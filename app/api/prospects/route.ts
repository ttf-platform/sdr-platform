import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

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

  // Cross-campaign lookup mode
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

  // Standard list mode
  const campaign_id = searchParams.get('campaign_id')
  const status      = searchParams.get('status')
  const source      = searchParams.get('source')
  const search      = searchParams.get('search')
  const sort        = searchParams.get('sort') ?? 'newest'
  const page        = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit       = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')))
  const offset      = (page - 1) * limit

  let query = admin
    .from('prospects')
    .select(
      '*, contacts!contact_id(first_name, last_name, company, title, linkedin_url, website), campaigns(id, name)',
      { count: 'exact' },
    )
    .eq('workspace_id', guard.workspaceId)

  if (campaign_id) query = query.eq('campaign_id', campaign_id)
  if (status)      query = query.in('status', status.split(',').map(s => s.trim()))
  if (source)      query = query.in('source', source.split(',').map(s => s.trim()))

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
