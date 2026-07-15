import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { onboardingProgressPatchSchema, badRequest } from '@/lib/schemas'

// Auto-detect step completions via live DB queries.
// ICP fields live on workspace_profiles (not workspaces).
// 5 steps: mailbox_connected implies domain_added (a verified email_account
// requires a row to exist), and campaign_launched (status='active') implies
// variants_reviewed (approval is a prerequisite for launch) — those pairs
// were merged in lot A.
async function detectCompletions(workspaceId: string) {
  const admin = createAdminClient()

  const [
    { data: profile },
    { count: emailAccountsVerified },
    { data: latestCampaign, count: campaignsCount },
    { count: prospectsCount },
    { count: launchedCount },
  ] = await Promise.all([
    // Step 1 — ICP configured: product_description + icp_description both present
    admin
      .from('workspace_profiles')
      .select('icp_description, product_description')
      .eq('workspace_id', workspaceId)
      .single(),

    // Step 2 — Sending inbox connected: DNS verified (covers "domain added")
    admin
      .from('email_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('setup_status', 'verified'),

    // Step 3 — Campaign created (exclude demo/sample campaigns)
    admin
      .from('campaigns')
      .select('id', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .eq('is_sample', false)
      .order('created_at', { ascending: false })
      .limit(1),

    // Step 4 — At least 1 prospect added (exclude demo/sample prospects)
    admin
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('is_sample', false),

    // Step 5 — Campaign launched (status='active') — implicitly covers
    // variants_reviewed since approval is required before launch.
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
  const mailbox_connected  = (emailAccountsVerified ?? 0) > 0
  const campaign_created   = (campaignsCount ?? 0) > 0
  const prospects_added    = (prospectsCount ?? 0) >= 1
  const campaign_launched  = (launchedCount ?? 0) >= 1
  const last_campaign_id   = latestCampaign?.[0]?.id ?? null

  return {
    icp_configured,
    mailbox_connected,
    campaign_created,
    prospects_added,
    campaign_launched,
    last_campaign_id,
  }
}

export async function GET() {
  const supabase = await createClient()
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
    completions.mailbox_connected,
    completions.campaign_created,
    completions.prospects_added,
    completions.campaign_launched,
  ].filter(Boolean).length

  return NextResponse.json({
    workspace_id:     workspaceId,
    stored:           storedState,
    completions,
    progress_percent: Math.round((stepsCompleted / 5) * 100),
    steps_completed:  stepsCompleted,
    total_steps:      5,
  })
}

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let rawBody: unknown
  try { rawBody = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = onboardingProgressPatchSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const updates: Record<string, unknown> = parsed.data

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
