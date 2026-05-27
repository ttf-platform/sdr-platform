import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { campaignCreateSchema, badRequest } from '@/lib/schemas'

export async function GET() {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  const [{ data: rawCampaigns, error }, { data: prospectRows }] = await Promise.all([
    admin.from('campaigns')
      .select('id, name, status, target_persona, angle, value_prop, cta, prospects_count, sent_count, opened_count, replied_count, meeting_count, smart_stop_on_reply, smart_stop_on_bounce, is_sample, created_at')
      .eq('workspace_id', guard.workspaceId)
      .order('created_at', { ascending: false }),
    admin.from('prospects')
      .select('campaign_id')
      .eq('workspace_id', guard.workspaceId)
      .not('campaign_id', 'is', null),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const countMap = new Map<string, number>()
  for (const r of (prospectRows ?? [])) {
    const id = r.campaign_id as string
    countMap.set(id, (countMap.get(id) ?? 0) + 1)
  }

  const campaigns = (rawCampaigns ?? []).map(c => ({ ...c, prospects_count: countMap.get(c.id) ?? 0 }))
  return NextResponse.json({ campaigns })
}

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const parsed = campaignCreateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)

  const {
    name, angle, value_prop, cta, target_persona,
    target_industry, target_titles, target_regions,
    company_sizes, company_revenue, tone, language,
    smart_stop_on_reply = true, smart_stop_on_bounce = true, booking_link_in_followups = false,
  } = parsed.data

  const admin = createAdminClient()

  // Reject duplicate names (case-insensitive) within the workspace
  // Use count to avoid maybeSingle() errors when multiple rows already match
  const safeName = name.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
  const { count: dupCount } = await admin
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', guard.workspaceId)
    .ilike('name', safeName)

  if ((dupCount ?? 0) > 0) {
    return NextResponse.json(
      { error: 'duplicate_name', message: 'A campaign with this name already exists.' },
      { status: 409 },
    )
  }

  const { data: campaign, error } = await admin
    .from('campaigns')
    .insert({
      workspace_id: guard.workspaceId,
      name: name.trim(),
      status: 'draft',
      angle:           angle           ?? null,
      value_prop:      value_prop      ?? null,
      cta:             cta             ?? null,
      target_persona:  target_persona  ?? null,
      target_industry: target_industry ?? null,
      target_titles:   target_titles   ?? null,
      target_regions:  target_regions  ?? null,
      company_sizes:   company_sizes   ?? null,
      company_revenue: company_revenue ?? null,
      tone:            tone            ?? null,
      language:        language        ?? 'English',
      smart_stop_on_reply,
      smart_stop_on_bounce,
      booking_link_in_followups,
      prospects_count: 0,
      sent_count: 0,
      opened_count: 0,
      replied_count: 0,
      meeting_count: 0,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ campaign }, { status: 201 })
}
