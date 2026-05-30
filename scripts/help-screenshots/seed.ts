/**
 * Idempotent seed script for the help center screenshots test account.
 * Run: npx tsx scripts/help-screenshots/seed.ts
 *
 * Resets and recreates: user, workspace, workspace_profile, email_account, ICP, prospects, campaign+drafts, signals.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'crypto'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const TEST_EMAIL = 'screenshots-bot@mirvo.test'
const TEST_PASSWORD = randomBytes(18).toString('base64url') + 'Aa1!'
const TEST_WORKSPACE_NAME = 'Screenshots Test'
const STATE_FILE = path.join(process.cwd(), 'scripts', 'help-screenshots', '.seed-state.json')

async function reset() {
  console.log('🔄 Resetting previous test data…')

  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const existing = users.find(u => u.email === TEST_EMAIL)

  if (existing) {
    const { data: memberships } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', existing.id)
    const wsIds = (memberships ?? []).map((m: { workspace_id: string }) => m.workspace_id)

    for (const wsId of wsIds) {
      const { data: ws } = await admin.from('workspaces').select('name').eq('id', wsId).single()
      if (ws?.name === TEST_WORKSPACE_NAME) {
        await admin.from('prospect_email_variants').delete().eq('workspace_id', wsId)
        await admin.from('prospects').delete().eq('workspace_id', wsId)
        await admin.from('contacts').delete().eq('workspace_id', wsId)
        const { data: campaigns } = await admin.from('campaigns').select('id').eq('workspace_id', wsId)
        const ids = (campaigns ?? []).map((c: { id: string }) => c.id)
        if (ids.length) await admin.from('campaign_steps').delete().in('campaign_id', ids)
        await admin.from('campaigns').delete().eq('workspace_id', wsId)
        await admin.from('signals').delete().eq('workspace_id', wsId)
        await admin.from('email_accounts').delete().eq('workspace_id', wsId)
        await admin.from('workspace_profiles').delete().eq('workspace_id', wsId)
        await admin.from('workspace_members').delete().eq('workspace_id', wsId)
        await admin.from('workspaces').delete().eq('id', wsId)
        console.log(`  ✅ Deleted workspace ${wsId}`)
      }
    }

    await admin.auth.admin.deleteUser(existing.id)
    console.log(`  ✅ Deleted user ${TEST_EMAIL}`)
  }
}

async function seed() {
  console.log('🌱 Seeding test account…')

  // 1. Create user (no email confirmation)
  const { data: { user }, error: userErr } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  })
  if (userErr || !user) { console.error('createUser failed', userErr); process.exit(1) }
  console.log(`  ✅ User created: ${user.id}`)

  // 2. Create workspace
  const { data: workspace, error: wsErr } = await admin
    .from('workspaces')
    .insert({
      name: TEST_WORKSPACE_NAME,
      slug: 'screenshots-test',
      plan: 'pro',
      plan_tier: 'pro',
      subscription_status: 'active',
      trial_start_date: new Date().toISOString(),
      trial_end_date: new Date(Date.now() + 30 * 86400_000).toISOString(),
      onboarding_state: { welcome_dismissed: true, checklist_dismissed: true, try_mirvo_mode: false },
    })
    .select()
    .single()
  if (wsErr || !workspace) { console.error('workspace insert failed', wsErr); process.exit(1) }
  console.log(`  ✅ Workspace: ${workspace.id}`)

  // 3. Add user as owner
  await admin.from('workspace_members').insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: 'owner',
  })

  // 4. Seed workspace profile (ICP + tone)
  await admin.from('workspace_profiles').insert({
    workspace_id: workspace.id,
    company_name: 'Sentra',
    sender_name: 'Screenshots Bot',
    product_description: 'AI-powered outbound platform that automates SDR workflows end-to-end.',
    icp_description: 'B2B SaaS founders and early sales hires (Series A–B, 10–100 employees) running outbound without a dedicated SDR.',
    value_proposition: 'From cold list to booked meetings — without hiring an SDR.',
    pain_points: 'Time wasted on manual list-building and template outreach that feels impersonal and gets ignored.',
    tone: 'direct',
    onboarding_completed: true,
    booking_slug: 'screenshots-bot-abcd',
  })
  console.log('  ✅ Workspace profile seeded')

  // 5. Seed mock email account (skip real OAuth)
  const { error: eaErr } = await admin.from('email_accounts').insert({
    workspace_id: workspace.id,
    domain: 'mirvo.test',
    email_address: TEST_EMAIL,
    sender_name: 'Screenshots Bot',
    provider_name: 'mock',
    warmup_status: 'active',
    setup_status: 'verified',
    dns_spf_verified: true,
    dns_dkim_verified: true,
    dns_dmarc_verified: true,
  })
  if (eaErr) console.warn('  ⚠️  email_account insert:', eaErr.message, '(non-fatal)')
  else console.log('  ✅ Email account seeded')

  // 6. Seed sample campaign
  const { data: campaign, error: campErr } = await admin
    .from('campaigns')
    .insert({
      workspace_id: workspace.id,
      name: 'Series A SaaS Founders — Outbound Demo',
      status: 'active',
      target_persona: 'Founders and first sales hires at Series A B2B SaaS startups',
      target_industry: 'B2B SaaS',
      target_titles: ['Founder', 'CEO', 'Head of Sales', 'VP Sales'],
      angle: 'We automate the full SDR workflow without a human SDR.',
      value_prop: 'From cold list to booked meetings — without hiring an SDR.',
      cta: 'Worth 15 minutes to see if it fits your pipeline?',
      tone: 'direct',
      language: 'en',
      is_sample: true,
    })
    .select()
    .single()
  if (campErr || !campaign) { console.error('campaign insert failed', campErr); process.exit(1) }
  console.log(`  ✅ Campaign: ${campaign.id}`)

  // 7. Campaign step
  const { data: step } = await admin
    .from('campaign_steps')
    .insert({
      campaign_id: campaign.id,
      step_order: 0,
      step_type: 'initial',
      subject: 'Scaling pipeline at {{company}}?',
      body: 'Hi {{first_name}},\n\nNoticed {{company}} recently expanded the sales team. When you\'re scaling outbound without a full SDR team, the bottleneck is usually time — not intent.\n\nWe automate the whole workflow: list to email to reply, with zero SDR headcount.\n\nWorth 15 minutes to see if it fits your pipeline?',
      delay_days: 0,
      is_sample: true,
    })
    .select()
    .single()

  // 8. Seed contacts + prospects + email variants (drafts in approval queue)
  const contacts = [
    { first_name: 'Sarah', last_name: 'Chen', company: 'Veloflow', title: 'CEO', email: 'sarah.chen@veloflow.demo' },
    { first_name: 'Marcus', last_name: 'Osei', company: 'Stacklane', title: 'Founder', email: 'marcus.osei@stacklane.demo' },
    { first_name: 'Priya', last_name: 'Rajan', company: 'Orbitly', title: 'Head of Sales', email: 'priya.rajan@orbitly.demo' },
    { first_name: 'James', last_name: 'Vidal', company: 'Driftbase', title: 'VP Sales', email: 'james.vidal@driftbase.demo' },
    { first_name: 'Elena', last_name: 'Morozova', company: 'Circlepath', title: 'CEO', email: 'elena.morozova@circlepath.demo' },
    { first_name: 'Noah', last_name: 'Abrams', company: 'Segmentify', title: 'Founder', email: 'noah.abrams@segmentify.demo' },
    { first_name: 'Mei', last_name: 'Tanaka', company: 'Looplight', title: 'Head of Revenue', email: 'mei.tanaka@looplight.demo' },
  ]

  for (const c of contacts) {
    const { data: contact } = await admin.from('contacts').insert({
      workspace_id: workspace.id,
      first_name: c.first_name, last_name: c.last_name,
      company: c.company, title: c.title, email: c.email,
      is_sample: true,
    }).select().single()
    if (!contact) continue

    const { data: prospect } = await admin.from('prospects').insert({
      workspace_id: workspace.id,
      campaign_id: campaign.id,
      contact_id: contact.id,
      email: c.email,
      status: 'found',
      source: 'manual',
      is_sample: true,
    }).select().single()
    if (!prospect || !step) continue

    await admin.from('prospect_email_variants').insert({
      workspace_id: workspace.id,
      prospect_id: prospect.id,
      campaign_step_id: step.id,
      subject: `Scaling pipeline at ${c.company}?`,
      body: `Hi ${c.first_name},\n\nNoticed ${c.company} recently expanded the sales team. When you're scaling outbound without a full SDR team, the bottleneck is usually time — not intent.\n\nWe automate the whole workflow: list to email to reply, with zero SDR headcount.\n\nWorth 15 minutes to see if it fits your pipeline?`,
      status: 'draft',
      is_sample: true,
    })
  }
  console.log(`  ✅ ${contacts.length} prospects + drafts seeded`)

  // 9. Seed signals
  const { error: sigErr } = await admin.from('signals').insert([
    {
      workspace_id: workspace.id,
      name: 'Series A funding rounds — B2B SaaS',
      source_type: 'template',
      template_id: 'recent_funding',
      monitoring_config: { funding_rounds: ['Series A', 'Series B'], industries: ['SaaS', 'B2B Software'] },
      is_active: true,
      is_sample: true,
    },
    {
      workspace_id: workspace.id,
      name: 'Hiring SDR or BDR roles',
      source_type: 'template',
      template_id: 'hiring_role',
      monitoring_config: { role_keywords: ['SDR', 'BDR', 'sales development rep', 'business development rep'] },
      is_active: true,
      is_sample: true,
    },
    {
      workspace_id: workspace.id,
      name: 'Migrating CRM or sales stack',
      source_type: 'custom',
      prompt_natural_language: 'Companies mentioning CRM migration, Salesforce implementation, or HubSpot migration',
      monitoring_config: { keywords: ['CRM migration', 'Salesforce implementation', 'HubSpot migration'] },
      is_active: false,
      is_sample: true,
    },
  ])
  if (sigErr) console.warn('  ⚠️  signals:', sigErr.message)
  else console.log('  ✅ 3 signals seeded')

  // 10. Save state file for capture script
  const state = { userId: user.id, workspaceId: workspace.id, campaignId: campaign.id, email: TEST_EMAIL, password: TEST_PASSWORD }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  console.log(`  ✅ State saved → ${STATE_FILE}`)
  console.log('\n✅ Seed complete.')
  console.log(`   email: ${TEST_EMAIL}`)
  console.log(`   password: ${TEST_PASSWORD}`)
  console.log(`   workspaceId: ${workspace.id}`)
}

async function main() {
  if (process.env.ALLOW_SEED !== '1') {
    console.error('❌ Refus : ce script provisionne un compte réel sur la DB pointée par .env.local.')
    console.error('   Relance avec ALLOW_SEED=1 si tu es sûr de la cible : ALLOW_SEED=1 npm run help:seed')
    process.exit(1)
  }
  await reset()
  await seed()
}

main().catch(e => { console.error(e); process.exit(1) })
