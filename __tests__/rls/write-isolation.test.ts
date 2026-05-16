import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestUser,
  seedFixtures,
  teardownTestUser,
  type TestUser,
  type Fixtures,
} from './setup'

// Shared users + fixtures for all three describe blocks in this file.
// Declared at module scope so UPDATE/DELETE describes can reference them.
let userA: TestUser
let userB: TestUser
let fixturesB: Fixtures

beforeAll(async () => {
  userA = await createTestUser('wi-a')
  await new Promise(r => setTimeout(r, 1000))
  userB = await createTestUser('wi-b')
  fixturesB = await seedFixtures(userB.workspaceId, userB.userId)
}, 60_000)

afterAll(async () => {
  await teardownTestUser(userA)
  await teardownTestUser(userB)
}, 30_000)

describe('RLS write isolation — INSERT cross-workspace', () => {

  function blocked(data: unknown, error: unknown): boolean {
    return error !== null || data === null || (Array.isArray(data) && data.length === 0)
  }

  it('campaigns: user A cannot INSERT into workspace B', async () => {
    const { data, error } = await userA.authedClient
      .from('campaigns')
      .insert({ workspace_id: userB.workspaceId, name: 'hack-campaign' })
    expect(blocked(data, error)).toBe(true)
  })

  it('contacts: user A cannot INSERT into workspace B', async () => {
    const { data, error } = await userA.authedClient
      .from('contacts')
      .insert({ workspace_id: userB.workspaceId, email: 'hack-contact@x.com' })
    expect(blocked(data, error)).toBe(true)
  })

  it('prospects: user A cannot INSERT into workspace B', async () => {
    const { data, error } = await userA.authedClient
      .from('prospects')
      .insert({
        workspace_id: userB.workspaceId,
        contact_id:   fixturesB.contactId,
        campaign_id:  fixturesB.campaignId,
        email:        'hack-prospect@x.com',
      })
    expect(blocked(data, error)).toBe(true)
  })

  it('prospect_emails: user A cannot INSERT into workspace B', async () => {
    const { data, error } = await userA.authedClient
      .from('prospect_emails')
      .insert({
        workspace_id:     userB.workspaceId,
        prospect_id:      fixturesB.prospectId,
        campaign_step_id: fixturesB.campaignStepId,
        subject:          'Hack Subject',
        body:             'Hack Body',
        mode:             'fast',
      })
    expect(blocked(data, error)).toBe(true)
  })

  it('deals: user A cannot INSERT into workspace B', async () => {
    const { data, error } = await userA.authedClient
      .from('deals')
      .insert({
        workspace_id: userB.workspaceId,
        prospect_id:  fixturesB.prospectId,
        source:       'manual',
        stage:        'new_lead',
      })
    expect(blocked(data, error)).toBe(true)
  })

  it('meetings: user A cannot INSERT into workspace B', async () => {
    const { data, error } = await userA.authedClient
      .from('meetings')
      .insert({
        workspace_id:   userB.workspaceId,
        user_id:        userA.userId,
        title:          'Hack Meeting',
        meeting_at:     new Date().toISOString(),
        attendee_email: 'hack@x.com',
      })
    expect(blocked(data, error)).toBe(true)
  })

  it('inbox_messages: user A cannot INSERT into workspace B', async () => {
    const { data, error } = await userA.authedClient
      .from('inbox_messages')
      .insert({
        workspace_id: userB.workspaceId,
        from_email:   'hack-from@x.com',
        to_email:     'hack-to@x.com',
      })
    expect(blocked(data, error)).toBe(true)
  })

  it('email_accounts: user A cannot INSERT into workspace B', async () => {
    const ts = Date.now()
    const domain = `hack-${ts}.x.com`
    const { data, error } = await userA.authedClient
      .from('email_accounts')
      .insert({
        workspace_id:  userB.workspaceId,
        domain,
        email_address: `hack@${domain}`,
        sender_name:   'Hack Sender',
      })
    expect(blocked(data, error)).toBe(true)
  })

  it('prospect_notes: user A cannot INSERT into workspace B', async () => {
    const { data, error } = await userA.authedClient
      .from('prospect_notes')
      .insert({
        workspace_id: userB.workspaceId,
        prospect_id:  fixturesB.prospectId,
        author_id:    userA.userId,
        content:      'Hack note content',
      })
    expect(blocked(data, error)).toBe(true)
  })

  it('prospect_tags: user A cannot INSERT into workspace B', async () => {
    const { data, error } = await userA.authedClient
      .from('prospect_tags')
      .insert({ workspace_id: userB.workspaceId, label: 'hack-tag' })
    expect(blocked(data, error)).toBe(true)
  })
})

describe('RLS write isolation — UPDATE cross-workspace', () => {
  it('campaigns: user A cannot UPDATE workspace B campaign', async () => {
    const { data } = await userA.authedClient
      .from('campaigns')
      .update({ name: 'hacked' })
      .eq('id', fixturesB.campaignId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('contacts: user A cannot UPDATE workspace B contact', async () => {
    const { data } = await userA.authedClient
      .from('contacts')
      .update({ first_name: 'Hacked' })
      .eq('id', fixturesB.contactId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('prospects: user A cannot UPDATE workspace B prospect', async () => {
    const { data } = await userA.authedClient
      .from('prospects')
      .update({ status: 'replied' })
      .eq('id', fixturesB.prospectId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('prospect_emails: user A cannot UPDATE workspace B prospect_email', async () => {
    const { data } = await userA.authedClient
      .from('prospect_emails')
      .update({ subject: 'Hacked Subject' })
      .eq('id', fixturesB.prospectEmailId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('deals: user A cannot UPDATE workspace B deal', async () => {
    const { data } = await userA.authedClient
      .from('deals')
      .update({ stage: 'closed_won' })
      .eq('id', fixturesB.dealId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('meetings: user A cannot UPDATE workspace B meeting', async () => {
    const { data } = await userA.authedClient
      .from('meetings')
      .update({ title: 'Hacked Meeting' })
      .eq('id', fixturesB.meetingId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('inbox_messages: user A cannot UPDATE workspace B inbox_message', async () => {
    const { data } = await userA.authedClient
      .from('inbox_messages')
      .update({ subject: 'Hacked' })
      .eq('id', fixturesB.inboxMessageId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('campaign_steps: user A cannot UPDATE workspace B campaign_step (indirect FK)', async () => {
    const { data } = await userA.authedClient
      .from('campaign_steps')
      .update({ body: 'Hacked body' })
      .eq('id', fixturesB.campaignStepId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })
})

describe('RLS write isolation — DELETE cross-workspace', () => {
  it('campaigns: user A cannot DELETE workspace B campaign', async () => {
    const { data } = await userA.authedClient
      .from('campaigns')
      .delete()
      .eq('id', fixturesB.campaignId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('contacts: user A cannot DELETE workspace B contact', async () => {
    const { data } = await userA.authedClient
      .from('contacts')
      .delete()
      .eq('id', fixturesB.contactId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('prospects: user A cannot DELETE workspace B prospect', async () => {
    const { data } = await userA.authedClient
      .from('prospects')
      .delete()
      .eq('id', fixturesB.prospectId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('prospect_emails: user A cannot DELETE workspace B prospect_email', async () => {
    const { data } = await userA.authedClient
      .from('prospect_emails')
      .delete()
      .eq('id', fixturesB.prospectEmailId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('deals: user A cannot DELETE workspace B deal', async () => {
    const { data } = await userA.authedClient
      .from('deals')
      .delete()
      .eq('id', fixturesB.dealId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('meetings: user A cannot DELETE workspace B meeting', async () => {
    const { data } = await userA.authedClient
      .from('meetings')
      .delete()
      .eq('id', fixturesB.meetingId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('inbox_messages: user A cannot DELETE workspace B inbox_message', async () => {
    const { data } = await userA.authedClient
      .from('inbox_messages')
      .delete()
      .eq('id', fixturesB.inboxMessageId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('campaign_steps: user A cannot DELETE workspace B campaign_step (indirect FK)', async () => {
    const { data } = await userA.authedClient
      .from('campaign_steps')
      .delete()
      .eq('id', fixturesB.campaignStepId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })
})
