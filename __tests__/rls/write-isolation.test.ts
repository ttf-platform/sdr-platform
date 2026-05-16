import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestUser,
  seedFixtures,
  teardownTestUser,
  type TestUser,
  type Fixtures,
} from './setup'

describe('RLS write isolation — INSERT cross-workspace', () => {
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
