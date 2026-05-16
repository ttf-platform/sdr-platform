import dotenv from 'dotenv'
import path from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY      = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export type TestUser = {
  userId:       string
  workspaceId:  string
  email:        string
  password:     string
  authedClient: SupabaseClient
}

export type Fixtures = {
  contactId:              string
  prospectId:             string
  campaignId:             string
  campaignStepId:         string
  prospectEmailId:        string
  dealId:                 string
  meetingId:              string
  inboxMessageId:         string
  emailAccountId:         string
  campaignSuggestionId:   string
  prospectNoteId:         string
  prospectTagId:          string
  prospectTagAssignmentId: string
  emailSendLogId:         string
  usageTrackingId:        string
  workspaceProfileId:     string
}

// Creates a Supabase user + workspace + workspace_members + workspace_profiles,
// then signs in to obtain a JWT-authenticated client that respects RLS.
export async function createTestUser(suffix: string): Promise<TestUser> {
  const ts       = Date.now()
  const email    = `test-rls-${suffix}-${ts}@example.com`
  const password = `TestRLS_${suffix}_${ts}!`
  const admin    = adminClient()

  const { data: userResp, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (userErr || !userResp.user) throw new Error(`createUser failed: ${userErr?.message}`)
  const userId = userResp.user.id

  const now      = new Date()
  const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

  const { data: workspace, error: wsErr } = await admin
    .from('workspaces')
    .insert({
      name:                `Test Workspace ${suffix} ${ts}`,
      slug:                `test-ws-${suffix}-${ts}`,
      plan:                'trial',
      plan_tier:           'starter',
      subscription_status: 'trialing',
      trial_start_date:    now.toISOString(),
      trial_end_date:      trialEnd.toISOString(),
    })
    .select('id')
    .single()
  if (wsErr || !workspace) throw new Error(`workspace insert failed: ${wsErr?.message}`)
  const workspaceId = workspace.id

  await admin.from('workspace_members').insert({
    workspace_id:    workspaceId,
    user_id:         userId,
    role:            'owner',
    invite_accepted: true,
  })

  await admin.from('workspace_profiles').insert({
    workspace_id:         workspaceId,
    company_name:         `Test Co ${suffix}`,
    onboarding_completed: true,
    booking_slug:         `test-${suffix}-${ts}`,
  })

  // Sign in with anon key to get a user JWT (required for RLS auth.uid() evaluation)
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: signIn, error: signInErr } = await anonClient.auth.signInWithPassword({
    email,
    password,
  })
  if (signInErr || !signIn.session) throw new Error(`signIn failed: ${signInErr?.message}`)

  const authedClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${signIn.session.access_token}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return { userId, workspaceId, email, password, authedClient }
}

// Creates a new user (with their own throwaway workspace) and adds them as a member
// of an existing workspace. Used to test intra-workspace author_only RLS patterns.
// teardownTestUser handles cleanup of the throwaway workspace; the target workspace
// membership row is cascade-deleted when the target workspace is torn down separately.
export async function addUserToWorkspace(
  suffix: string,
  targetWorkspaceId: string,
  role: 'owner' | 'admin' | 'member' = 'member',
): Promise<TestUser> {
  const user  = await createTestUser(suffix)
  const admin = adminClient()
  await admin.from('workspace_members').insert({
    workspace_id:    targetWorkspaceId,
    user_id:         user.userId,
    role,
    invite_accepted: true,
  })
  return user
}

// Deletes auth user first (higher priority — avoids orphan auth quotas),
// then deletes workspace (CASCADE wipes all child rows).
// Both steps wrapped in try/catch so a partial failure doesn't abort the other.
export async function teardownTestUser(user: TestUser): Promise<void> {
  const admin = adminClient()

  try {
    await admin.auth.admin.deleteUser(user.userId)
  } catch (err) {
    console.warn('[teardownTestUser] Failed to delete auth user', user.userId, err)
  }

  try {
    await admin.from('workspaces').delete().eq('id', user.workspaceId)
  } catch (err) {
    console.warn('[teardownTestUser] Failed to delete workspace', user.workspaceId, err)
  }
}

// Seeds 1 row in each workspace-scoped table via the admin client (bypasses RLS).
// Respects FK insert order. author_id is set on prospect_notes for author-only tests.
export async function seedFixtures(workspaceId: string, userId: string): Promise<Fixtures> {
  const admin = adminClient()
  const ts    = Date.now()

  // 1. campaign
  const { data: campaign, error: campaignErr } = await admin
    .from('campaigns')
    .insert({ workspace_id: workspaceId, name: `Seed Campaign ${ts}` })
    .select('id')
    .single()
  if (!campaign) throw new Error(`campaign seed failed: ${campaignErr?.message}`)

  // 2. campaign_step (scoped via campaign_id, no direct workspace_id column)
  const { data: campaignStep, error: stepErr } = await admin
    .from('campaign_steps')
    .insert({
      campaign_id: campaign.id,
      step_order:  0,
      step_type:   'initial',
      delay_days:  0,
      body:        'Seed body',
    })
    .select('id')
    .single()
  if (!campaignStep) throw new Error(`campaign_step seed failed: ${stepErr?.message}`)

  // 3. contact
  const { data: contact, error: contactErr } = await admin
    .from('contacts')
    .insert({ workspace_id: workspaceId, email: `seed-contact-${ts}@example.com` })
    .select('id')
    .single()
  if (!contact) throw new Error(`contact seed failed: ${contactErr?.message}`)

  // 4. prospect (requires contact_id after migration 013)
  const { data: prospect, error: prospectErr } = await admin
    .from('prospects')
    .insert({
      workspace_id: workspaceId,
      contact_id:   contact.id,
      email:        `seed-contact-${ts}@example.com`,
      campaign_id:  campaign.id,
    })
    .select('id')
    .single()
  if (!prospect) throw new Error(`prospect seed failed: ${prospectErr?.message}`)

  // 5. prospect_email
  const { data: prospectEmail, error: peErr } = await admin
    .from('prospect_emails')
    .insert({
      workspace_id:     workspaceId,
      prospect_id:      prospect.id,
      campaign_step_id: campaignStep.id,
      subject:          'Seed Subject',
      body:             'Seed Body',
      mode:             'fast',
    })
    .select('id')
    .single()
  if (!prospectEmail) throw new Error(`prospect_email seed failed: ${peErr?.message}`)

  // 6. deal — source/stage NOT NULL, defaults may not be applied in prod DB
  const { data: deal, error: dealErr } = await admin
    .from('deals')
    .insert({ workspace_id: workspaceId, prospect_id: prospect.id, source: 'manual', stage: 'new_lead' })
    .select('id')
    .single()
  if (!deal) throw new Error(`deal seed failed: ${dealErr?.message}`)

  // 7. meeting
  const { data: meeting, error: meetingErr } = await admin
    .from('meetings')
    .insert({
      workspace_id:   workspaceId,
      user_id:        userId,
      title:          'Seed Meeting',
      meeting_at:     new Date().toISOString(),
      attendee_email: 'attendee@example.com',
    })
    .select('id')
    .single()
  if (!meeting) throw new Error(`meeting seed failed: ${meetingErr?.message}`)

  // 8. inbox_message
  const { data: inboxMessage, error: imErr } = await admin
    .from('inbox_messages')
    .insert({
      workspace_id: workspaceId,
      from_email:   'from@example.com',
      to_email:     'to@example.com',
    })
    .select('id')
    .single()
  if (!inboxMessage) throw new Error(`inbox_message seed failed: ${imErr?.message}`)

  // 9. email_account (domain + email_address must be unique in workspace)
  const domain = `seed-${ts}.example.com`
  const { data: emailAccount, error: eaErr } = await admin
    .from('email_accounts')
    .insert({
      workspace_id:  workspaceId,
      domain,
      email_address: `sender@${domain}`,
      sender_name:   'Seed Sender',
    })
    .select('id')
    .single()
  if (!emailAccount) throw new Error(`email_account seed failed: ${eaErr?.message}`)

  // 10. campaign_suggestion
  const { data: campaignSuggestion, error: csErr } = await admin
    .from('campaign_suggestions')
    .insert({ workspace_id: workspaceId, name: 'Seed Suggestion' })
    .select('id')
    .single()
  if (!campaignSuggestion) throw new Error(`campaign_suggestion seed failed: ${csErr?.message}`)

  // 11. prospect_note — author_id set to userId for author-only policy tests
  const { data: prospectNote, error: pnErr } = await admin
    .from('prospect_notes')
    .insert({
      workspace_id: workspaceId,
      prospect_id:  prospect.id,
      author_id:    userId,
      content:      'Seed note content',
    })
    .select('id')
    .single()
  if (!prospectNote) throw new Error(`prospect_note seed failed: ${pnErr?.message}`)

  // 12. prospect_tag
  const { data: prospectTag, error: ptErr } = await admin
    .from('prospect_tags')
    .insert({ workspace_id: workspaceId, label: `seed-tag-${ts}` })
    .select('id')
    .single()
  if (!prospectTag) throw new Error(`prospect_tag seed failed: ${ptErr?.message}`)

  // 13. prospect_tag_assignment — links the prospect to the tag
  const { data: prospectTagAssignment, error: ptaErr } = await admin
    .from('prospect_tag_assignments')
    .insert({ prospect_id: prospect.id, tag_id: prospectTag.id, created_by: userId })
    .select('id')
    .single()
  if (!prospectTagAssignment) throw new Error(`prospect_tag_assignment seed failed: ${ptaErr?.message}`)

  // 14. email_send_log (service role INSERT — no user INSERT policy)
  const { data: emailSendLog, error: eslErr } = await admin
    .from('email_send_log')
    .insert({ workspace_id: workspaceId, provider: 'mock', status: 'sent' })
    .select('id')
    .single()
  if (!emailSendLog) throw new Error(`email_send_log seed failed: ${eslErr?.message}`)

  // 15. usage_tracking (service role INSERT — no user INSERT policy)
  const periodStart = new Date()
  periodStart.setDate(1)
  const { data: usageTracking, error: utErr } = await admin
    .from('usage_tracking')
    .insert({
      workspace_id: workspaceId,
      metric:       'prospects_added',
      value:        1,
      period_start: periodStart.toISOString().slice(0, 10),
    })
    .select('id')
    .single()
  if (!usageTracking) throw new Error(`usage_tracking seed failed: ${utErr?.message}`)

  // 16. workspace_profile — created in createTestUser, just fetch the ID
  const { data: wsProfile } = await admin
    .from('workspace_profiles')
    .select('id')
    .eq('workspace_id', workspaceId)
    .single()

  return {
    contactId:               contact.id,
    prospectId:              prospect.id,
    campaignId:              campaign.id,
    campaignStepId:          campaignStep.id,
    prospectEmailId:         prospectEmail.id,
    dealId:                  deal.id,
    meetingId:               meeting.id,
    inboxMessageId:          inboxMessage.id,
    emailAccountId:          emailAccount.id,
    campaignSuggestionId:    campaignSuggestion.id,
    prospectNoteId:          prospectNote.id,
    prospectTagId:           prospectTag.id,
    prospectTagAssignmentId: prospectTagAssignment.id,
    emailSendLogId:          emailSendLog.id,
    usageTrackingId:         usageTracking.id,
    workspaceProfileId:      wsProfile?.id ?? '',
  }
}
