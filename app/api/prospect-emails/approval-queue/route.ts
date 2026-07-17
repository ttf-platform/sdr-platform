import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/prospect-emails/approval-queue
//
// Workspace-wide "drafts to approve" queue. Returns every prospect_email in
// status 'draft' or 'edited' — the same shape that `dashboard/stats` counts as
// `draftsToApprove` — grouped by campaign, ready for a global review page.
//
// Groups are ordered by volume (largest backlog first) so the reviewer's eye
// lands on the campaigns most worth their time. Inside a group, drafts are
// ordered by step_order asc then generated_at desc — earliest steps first
// (initial before follow-ups), most recent first.
//
// Limit 500 rows across the workspace. This is a review page for a human,
// not an analytics endpoint. Pagination is intentionally deferred to v2 — at
// 500 drafts the UX priority is bulk-approve or "get to inbox zero", not
// scrolling further.
//
// Vendor-invisibility: this route only exposes id/subject/body/mode/status/
// generated_at + prospect + step + campaign shell — no provider columns.
export async function GET() {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  // Step 1 — pull the drafts. We use a flat select and join the rest manually
  // to keep the failure mode readable if PostgREST refuses a deep embed.
  const { data: rawDrafts, error: draftsError } = await admin
    .from('prospect_emails')
    .select('id, subject, body, mode, status, generated_at, prospect_id, campaign_step_id')
    .eq('workspace_id', guard.workspaceId)
    .in('status', ['draft', 'edited'])
    .order('generated_at', { ascending: false })
    .limit(500)

  if (draftsError) {
    return NextResponse.json({ error: draftsError.message }, { status: 500 })
  }

  if (!rawDrafts || rawDrafts.length === 0) {
    return NextResponse.json({ groups: [], total_drafts: 0, total_campaigns: 0 })
  }

  const prospectIds = [...new Set(rawDrafts.map(d => d.prospect_id).filter(Boolean))]
  const stepIds     = [...new Set(rawDrafts.map(d => d.campaign_step_id).filter(Boolean))]

  const [prospectsRes, stepsRes] = await Promise.all([
    admin
      .from('prospects')
      .select('id, email, contacts!contact_id(first_name, last_name, company, title)')
      .in('id', prospectIds)
      .eq('workspace_id', guard.workspaceId),
    admin
      .from('campaign_steps')
      .select('id, step_order, step_type, campaign_id')
      .in('id', stepIds),
  ])

  if (prospectsRes.error) return NextResponse.json({ error: prospectsRes.error.message }, { status: 500 })
  if (stepsRes.error)     return NextResponse.json({ error: stepsRes.error.message },     { status: 500 })

  const campaignIds = [...new Set((stepsRes.data ?? []).map(s => s.campaign_id).filter(Boolean))]

  const { data: campaigns, error: campaignsError } = await admin
    .from('campaigns')
    .select('id, name, status, personalization_mode')
    .in('id', campaignIds)
    .eq('workspace_id', guard.workspaceId)

  if (campaignsError) return NextResponse.json({ error: campaignsError.message }, { status: 500 })

  const prospectMap = new Map((prospectsRes.data ?? []).map(p => [p.id, p]))
  const stepMap     = new Map((stepsRes.data ?? []).map(s => [s.id, s]))
  const campaignMap = new Map((campaigns ?? []).map(c => [c.id, c]))

  type DraftItem = {
    id:            string
    subject:       string
    body:          string
    mode:          'fast' | 'smart' | null
    status:        'draft' | 'edited'
    generated_at:  string
    step_order:    number | null
    step_type:     string | null
    prospect: {
      id:         string
      email:      string | null
      first_name: string | null
      last_name:  string | null
      company:    string | null
      title:      string | null
    }
  }

  type CampaignGroup = {
    campaign: {
      id:                   string
      name:                 string
      status:               string | null
      personalization_mode: 'fast' | 'smart' | null
    }
    drafts:       DraftItem[]
    drafts_count: number
  }

  const groups = new Map<string, CampaignGroup>()

  for (const d of rawDrafts) {
    const step = stepMap.get(d.campaign_step_id)
    if (!step) continue                         // draft orphelin, on ignore
    const campaign = campaignMap.get(step.campaign_id)
    if (!campaign) continue                     // cross-workspace fantôme, defence-in-depth
    const prospect = prospectMap.get(d.prospect_id)
    if (!prospect) continue

    const contact = Array.isArray(prospect.contacts) ? prospect.contacts[0] : prospect.contacts
    const draft: DraftItem = {
      id:           d.id,
      subject:      d.subject ?? '',
      body:         d.body ?? '',
      mode:         d.mode as 'fast' | 'smart' | null,
      status:       d.status as 'draft' | 'edited',
      generated_at: d.generated_at,
      step_order:   step.step_order,
      step_type:    step.step_type,
      prospect: {
        id:         prospect.id,
        email:      prospect.email ?? null,
        first_name: contact?.first_name ?? null,
        last_name:  contact?.last_name ?? null,
        company:    contact?.company ?? null,
        title:      contact?.title ?? null,
      },
    }

    const existing = groups.get(campaign.id)
    if (existing) {
      existing.drafts.push(draft)
      existing.drafts_count += 1
    } else {
      groups.set(campaign.id, {
        campaign: {
          id:                   campaign.id,
          name:                 campaign.name,
          status:               campaign.status,
          personalization_mode: campaign.personalization_mode as 'fast' | 'smart' | null,
        },
        drafts:       [draft],
        drafts_count: 1,
      })
    }
  }

  // Sort drafts inside each group by step_order asc then generated_at desc.
  for (const group of groups.values()) {
    group.drafts.sort((a, b) => {
      const so = (a.step_order ?? 0) - (b.step_order ?? 0)
      if (so !== 0) return so
      return b.generated_at.localeCompare(a.generated_at)
    })
  }

  // Groups by drafts_count desc — the reviewer's eye lands on the biggest
  // backlog first. Tie-break on campaign name for stability.
  const groupList = Array.from(groups.values()).sort((a, b) => {
    const dc = b.drafts_count - a.drafts_count
    if (dc !== 0) return dc
    return a.campaign.name.localeCompare(b.campaign.name)
  })

  return NextResponse.json({
    groups:          groupList,
    total_drafts:    groupList.reduce((n, g) => n + g.drafts_count, 0),
    total_campaigns: groupList.length,
  })
}
