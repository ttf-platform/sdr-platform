import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Auto-detect step completions via live DB queries.
// ICP fields live on workspace_profiles (not workspaces).
async function detectCompletions(workspaceId: string) {
  const admin = createAdminClient()

  const [
    { data: profile },
    { count: emailAccountsTotal },
    { count: emailAccountsVerified },
    { data: latestCampaign, count: campaignsCount },
    { count: prospectsCount },
    { count: approvedEmailsCount },
    { count: launchedCount },
  ] = await Promise.all([
    // Step 1 — ICP configured: product_description + icp_description both present
    admin
      .from('workspace_profiles')
      .select('icp_description, product_description')
      .eq('workspace_id', workspaceId)
      .single(),

    // Step 2 — Sending domain added: any email_account record
    admin
      .from('email_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId),

    // Step 3 — Mailbox connected: DNS verified
    admin
      .from('email_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('setup_status', 'verified'),

    // Step 4 — Campaign created (exclude demo/sample campaigns)
    admin
      .from('campaigns')
      .select('id', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .eq('is_sample', false)
      .order('created_at', { ascending: false })
      .limit(1),

    // Step 5 — At least 1 prospect added (exclude demo/sample prospects)
    admin
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('is_sample', false),

    // Step 6 — At least 1 email draft approved (exclude demo/sample emails)
    admin
      .from('prospect_emails')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('is_sample', false)
      .eq('status', 'approved'),

    // Step 7 — Campaign launched (status = active, exclude demo/sample campaigns)
    admin
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('is_sample', false)
      .eq('status', 'active'),
  ])

  const icp_configured = Boolean(
    profile?.icp_description?.trim() && profile?.product_description?.trim()
  )
  const domain_added       = (emailAccountsTotal ?? 0) > 0
  const mailbox_connected  = (emailAccountsVerified ?? 0) > 0
  const campaign_created   = (campaignsCount ?? 0) > 0
  const prospects_added    = (prospectsCount ?? 0) >= 1
  const variants_reviewed  = (approvedEmailsCount ?? 0) >= 1
  const campaign_launched  = (launchedCount ?? 0) >= 1
  const last_campaign_id   = latestCampaign?.[0]?.id ?? null

  return {
    icp_configured,
    domain_added,
    mailbox_connected,
    campaign_created,
    prospects_added,
    variants_reviewed,
    campaign_launched,
    last_campaign_id,
  }
}

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('workspace_members')
    .select('workspace_id, workspaces!inner(onboarding_state)')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  const workspaceId  = member.workspace_id as string
  const storedState  = (member as any).workspaces?.onboarding_state ?? {}
  const completions  = await detectCompletions(workspaceId)

  const stepsCompleted = [
    completions.icp_configured,
    completions.domain_added,
    completions.mailbox_connected,
    completions.campaign_created,
    completions.prospects_added,
    completions.variants_reviewed,
    completions.campaign_launched,
  ].filter(Boolean).length

  return NextResponse.json({
    workspace_id:     workspaceId,
    stored:           storedState,
    completions,
    progress_percent: Math.round((stepsCompleted / 7) * 100),
    steps_completed:  stepsCompleted,
    total_steps:      7,
  })
}

const ALLOWED_PATCH_FIELDS = [
  'welcome_dismissed',
  'checklist_dismissed',
  'try_mirvo_mode',
  'last_campaign_id',
] as const

export async function PATCH(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const updates: Record<string, unknown> = {}
  for (const key of ALLOWED_PATCH_FIELDS) {
    if (body !== null && typeof body === 'object' && key in (body as object)) {
      updates[key] = (body as Record<string, unknown>)[key]
    }
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('workspace_members')
    .select('workspace_id, workspaces!inner(onboarding_state)')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  const workspaceId  = member.workspace_id as string
  const currentState = (member as any).workspaces?.onboarding_state ?? {}
  const newState     = { ...currentState, ...updates }

  const { error } = await admin
    .from('workspaces')
    .update({ onboarding_state: newState })
    .eq('id', workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, onboarding_state: newState })
}
