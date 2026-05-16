import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestUser,
  seedFixtures,
  teardownTestUser,
  type TestUser,
  type Fixtures,
} from './setup'

describe('RLS missing tables — prospect_tag_assignments, usage_tracking, admin_actions_log', () => {
  let userA: TestUser
  let userB: TestUser
  let fixturesA: Fixtures
  let fixturesB: Fixtures

  beforeAll(async () => {
    userA = await createTestUser('mt-a')
    await new Promise(r => setTimeout(r, 1000))
    userB = await createTestUser('mt-b')
    ;[fixturesA, fixturesB] = await Promise.all([
      seedFixtures(userA.workspaceId, userA.userId),
      seedFixtures(userB.workspaceId, userB.userId),
    ])
  }, 60_000)

  afterAll(async () => {
    await teardownTestUser(userA)
    await teardownTestUser(userB)
  }, 30_000)

  // prospect_tag_assignments — Pattern B: indirect FK via prospect_id

  it('prospect_tag_assignments: user A cannot SELECT workspace B assignment (indirect FK)', async () => {
    const { data } = await userA.authedClient
      .from('prospect_tag_assignments')
      .select('*')
      .eq('prospect_id', fixturesB.prospectId)
    expect(data?.length ?? 0).toBe(0)
  })

  it('prospect_tag_assignments: user A cannot INSERT assignment for workspace B prospect', async () => {
    const { data, error } = await userA.authedClient
      .from('prospect_tag_assignments')
      .insert({
        prospect_id: fixturesB.prospectId,
        tag_id:      fixturesB.prospectTagId,
        created_by:  userA.userId,
      })
      .select()
    expect(error !== null || (data?.length ?? 0) === 0).toBe(true)
  })

  it('prospect_tag_assignments: user A CAN SELECT own workspace assignment (positive sanity)', async () => {
    const { data } = await userA.authedClient
      .from('prospect_tag_assignments')
      .select('*')
      .eq('prospect_id', fixturesA.prospectId)
    expect(data?.length ?? 0).toBeGreaterThan(0)
  })

  // usage_tracking — Pattern E: SELECT via workspace_member, no user INSERT policy

  it('usage_tracking: user A cannot SELECT workspace B usage_tracking', async () => {
    const { data } = await userA.authedClient
      .from('usage_tracking')
      .select('*')
      .eq('workspace_id', userB.workspaceId)
    expect(data?.length ?? 0).toBe(0)
  })

  it('usage_tracking: user A CAN SELECT own workspace usage_tracking (positive sanity)', async () => {
    const { data } = await userA.authedClient
      .from('usage_tracking')
      .select('*')
      .eq('workspace_id', userA.workspaceId)
    expect(data?.length ?? 0).toBeGreaterThan(0)
  })

  // admin_actions_log — Pattern D: SELECT via is_sentra_admin JWT claim

  it('admin_actions_log: non-admin user A receives empty data', async () => {
    const { data } = await userA.authedClient
      .from('admin_actions_log')
      .select('*')
    expect(data?.length ?? 0).toBe(0)
  })
})
