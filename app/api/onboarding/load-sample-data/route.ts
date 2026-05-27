import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST() {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { workspaceId } = guard

  // Check if sample data already exists
  const { count: existing } = await admin
    .from('campaigns')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('is_sample', true)

  if ((existing ?? 0) > 0) {
    return NextResponse.json({ ok: true, already_loaded: true })
  }

  // Insert sample campaign
  const { data: campaign, error: campaignErr } = await admin
    .from('campaigns')
    .insert({
      workspace_id:    workspaceId,
      name:            'SaaS CTOs — Pain-Led Outbound (Demo)',
      status:          'draft',
      target_persona:  'CTOs and VPs of Engineering at B2B SaaS companies (50–500 employees)',
      target_industry: 'B2B SaaS',
      target_titles:   ['CTO', 'VP Engineering', 'Head of Engineering'],
      angle:           'We help engineering leaders ship faster by eliminating manual deployment bottlenecks.',
      value_prop:      'Cut deployment time from hours to minutes — without touching your existing stack.',
      cta:             '15-minute call to walk through your current deploy pipeline',
      tone:            'professional',
      language:        'en',
      is_sample:       true,
    })
    .select()
    .single()

  if (campaignErr || !campaign) {
    console.error('[load-sample-data] Failed to insert campaign:', campaignErr)
    return NextResponse.json({ error: 'Failed to create sample campaign' }, { status: 500 })
  }

  // Insert sample campaign step
  const { data: step, error: stepErr } = await admin
    .from('campaign_steps')
    .insert({
      campaign_id: campaign.id,
      step_order:  0,
      step_type:   'email',
      subject:     'Deploying faster at {{company}}?',
      delay_days:  0,
      is_sample:   true,
    })
    .select()
    .single()

  if (stepErr) {
    console.error('[load-sample-data] Failed to insert campaign step:', stepErr)
  }

  // Insert 5 sample contacts + prospects
  const sampleContacts = [
    { first_name: 'James',  last_name: 'Harrington', company: 'Streamline HQ',   title: 'CTO',                 email: 'james.harrington@streamlinehq.demo' },
    { first_name: 'Priya',  last_name: 'Mehta',      company: 'Cloudbase Labs',  title: 'VP Engineering',      email: 'priya.mehta@cloudbaselabs.demo' },
    { first_name: 'Marcus', last_name: 'Weber',      company: 'Nexflow Systems', title: 'Head of Engineering', email: 'marcus.weber@nexflowsystems.demo' },
    { first_name: 'Sofia',  last_name: 'Reyes',      company: 'Pivotly',         title: 'CTO',                 email: 'sofia.reyes@pivotly.demo' },
    { first_name: 'Daniel', last_name: 'Kim',         company: 'BuildStack AI',   title: 'VP Engineering',      email: 'daniel.kim@buildstackai.demo' },
  ]

  for (const c of sampleContacts) {
    const { data: contact, error: contactErr } = await admin
      .from('contacts')
      .insert({
        workspace_id: workspaceId,
        first_name:   c.first_name,
        last_name:    c.last_name,
        company:      c.company,
        title:        c.title,
        email:        c.email,
        is_sample:    true,
      })
      .select()
      .single()

    if (contactErr || !contact) {
      console.error('[load-sample-data] Failed to insert contact:', contactErr)
      continue
    }

    const { data: prospect, error: prospectErr } = await admin
      .from('prospects')
      .insert({
        workspace_id: workspaceId,
        campaign_id:  campaign.id,
        contact_id:   contact.id,
        email:        c.email,
        status:       'pending',
        source:       'sample',
        is_sample:    true,
      })
      .select()
      .single()

    if (prospectErr || !prospect) {
      console.error('[load-sample-data] Failed to insert prospect:', prospectErr)
      continue
    }

    if (!step) continue

    const { error: variantErr } = await admin
      .from('prospect_email_variants')
      .insert({
        workspace_id:     workspaceId,
        prospect_id:      prospect.id,
        campaign_step_id: step.id,
        subject:          `Deploying faster at ${c.company}?`,
        body:             `Hi ${c.first_name},\n\nI noticed ${c.company} has been scaling the engineering team rapidly. When deployment cycles start slowing down growth, it's usually the pipeline that's the bottleneck — not the team.\n\nWe help engineering leaders like you cut deploy time from hours to minutes without changing your existing stack.\n\nWould a 15-minute call next week be worth it to see if there's a fit?\n\nBest,\n[Your name]`,
        status:           'draft',
        is_sample:        true,
      })

    if (variantErr) {
      console.error('[load-sample-data] Failed to insert variant:', variantErr)
    }
  }

  // Insert 2 sample signals
  const { error: signalsErr } = await admin
    .from('signals')
    .insert([
      {
        workspace_id:      workspaceId,
        name:              'SaaS companies hiring backend engineers (Demo)',
        source_type:       'template',
        template_id:       'hiring_role',
        monitoring_config: { role_keywords: ['backend engineer', 'software engineer', 'platform engineer'] },
        is_active:         false,
        is_sample:         true,
      },
      {
        workspace_id:      workspaceId,
        name:              'Series A/B SaaS funding rounds (Demo)',
        source_type:       'template',
        template_id:       'recent_funding',
        monitoring_config: { funding_rounds: ['Series A', 'Series B'], industries: ['SaaS', 'B2B Software'] },
        is_active:         false,
        is_sample:         true,
      },
    ])

  if (signalsErr) {
    console.error('[load-sample-data] Failed to insert signals:', signalsErr)
  }

  // Set try_mirvo_mode in onboarding_state
  const { data: ws } = await admin
    .from('workspaces')
    .select('onboarding_state')
    .eq('id', workspaceId)
    .single()

  const currentState = (ws?.onboarding_state as Record<string, unknown>) ?? {}
  await admin
    .from('workspaces')
    .update({ onboarding_state: { ...currentState, try_mirvo_mode: true } })
    .eq('id', workspaceId)

  return NextResponse.json({ ok: true, campaign_id: campaign.id })
}
