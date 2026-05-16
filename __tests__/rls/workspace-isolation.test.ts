import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestUser,
  teardownTestUser,
  seedFixtures,
  type TestUser,
  type Fixtures,
} from './setup'

describe('RLS workspace isolation', () => {
  let userA: TestUser
  let userB: TestUser
  let fixturesA: Fixtures
  let fixturesB: Fixtures

  beforeAll(async () => {
    userA = await createTestUser('a')
    await new Promise(r => setTimeout(r, 1000)) // space out auth calls
    userB = await createTestUser('b')
    ;[fixturesA, fixturesB] = await Promise.all([
      seedFixtures(userA.workspaceId, userA.userId),
      seedFixtures(userB.workspaceId, userB.userId),
    ])
  }, 60_000)

  afterAll(async () => {
    await teardownTestUser(userA)
    await teardownTestUser(userB)
  }, 30_000)

  it('campaigns: user A cannot read workspace B campaigns', async () => {
    const { data, error } = await userA.authedClient
      .from('campaigns')
      .select('id')
      .eq('workspace_id', userB.workspaceId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('contacts: user A cannot read workspace B contacts', async () => {
    const { data, error } = await userA.authedClient
      .from('contacts')
      .select('id')
      .eq('workspace_id', userB.workspaceId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('prospects: user A cannot read workspace B prospects', async () => {
    const { data, error } = await userA.authedClient
      .from('prospects')
      .select('id')
      .eq('workspace_id', userB.workspaceId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('prospect_emails: user A cannot read workspace B prospect_emails', async () => {
    const { data, error } = await userA.authedClient
      .from('prospect_emails')
      .select('id')
      .eq('workspace_id', userB.workspaceId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  // campaign_steps has no workspace_id column — RLS scoped via campaign_id → campaigns.workspace_id
  it('campaign_steps: user A cannot read workspace B campaign_steps', async () => {
    const { data, error } = await userA.authedClient
      .from('campaign_steps')
      .select('id')
      .eq('campaign_id', fixturesB.campaignId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('campaign_suggestions: user A cannot read workspace B campaign_suggestions', async () => {
    const { data, error } = await userA.authedClient
      .from('campaign_suggestions')
      .select('id')
      .eq('workspace_id', userB.workspaceId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('deals: user A cannot read workspace B deals', async () => {
    const { data, error } = await userA.authedClient
      .from('deals')
      .select('id')
      .eq('workspace_id', userB.workspaceId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('meetings: user A cannot read workspace B meetings', async () => {
    const { data, error } = await userA.authedClient
      .from('meetings')
      .select('id')
      .eq('workspace_id', userB.workspaceId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('inbox_messages: user A cannot read workspace B inbox_messages', async () => {
    const { data, error } = await userA.authedClient
      .from('inbox_messages')
      .select('id')
      .eq('workspace_id', userB.workspaceId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('email_accounts: user A cannot read workspace B email_accounts', async () => {
    const { data, error } = await userA.authedClient
      .from('email_accounts')
      .select('id')
      .eq('workspace_id', userB.workspaceId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('email_send_log: user A cannot read workspace B email_send_log', async () => {
    const { data, error } = await userA.authedClient
      .from('email_send_log')
      .select('id')
      .eq('workspace_id', userB.workspaceId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('prospect_notes: user A cannot read workspace B prospect_notes', async () => {
    const { data, error } = await userA.authedClient
      .from('prospect_notes')
      .select('id')
      .eq('workspace_id', userB.workspaceId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('prospect_tags: user A cannot read workspace B prospect_tags', async () => {
    const { data, error } = await userA.authedClient
      .from('prospect_tags')
      .select('id')
      .eq('workspace_id', userB.workspaceId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('workspace_profiles: user A cannot read workspace B workspace_profiles', async () => {
    const { data, error } = await userA.authedClient
      .from('workspace_profiles')
      .select('id')
      .eq('workspace_id', userB.workspaceId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})

describe('Positive: user can read own workspace data (sanity check)', () => {
  let userA: TestUser
  let fixturesA: Fixtures

  beforeAll(async () => {
    userA = await createTestUser('pos-a')
    fixturesA = await seedFixtures(userA.workspaceId, userA.userId)
  }, 60_000)

  afterAll(async () => {
    await teardownTestUser(userA)
  }, 30_000)

  it('campaigns: user A can SELECT own campaigns', async () => {
    const { data, error } = await userA.authedClient
      .from('campaigns')
      .select('id')
      .eq('id', fixturesA.campaignId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(fixturesA.campaignId)
  })

  it('prospects: user A can SELECT own prospects', async () => {
    const { data, error } = await userA.authedClient
      .from('prospects')
      .select('id')
      .eq('id', fixturesA.prospectId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(fixturesA.prospectId)
  })

  it('inbox_messages: user A can SELECT own inbox_messages', async () => {
    const { data, error } = await userA.authedClient
      .from('inbox_messages')
      .select('id')
      .eq('id', fixturesA.inboxMessageId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(fixturesA.inboxMessageId)
  })

  it('campaign_steps: user A can SELECT own campaign_steps (via campaign_id FK)', async () => {
    const { data, error } = await userA.authedClient
      .from('campaign_steps')
      .select('id')
      .eq('id', fixturesA.campaignStepId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(fixturesA.campaignStepId)
  })

  it('prospect_notes: user A can SELECT own prospect_notes', async () => {
    const { data, error } = await userA.authedClient
      .from('prospect_notes')
      .select('id')
      .eq('id', fixturesA.prospectNoteId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(fixturesA.prospectNoteId)
  })
})
