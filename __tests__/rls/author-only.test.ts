import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestUser,
  addUserToWorkspace,
  seedFixtures,
  teardownTestUser,
  type TestUser,
  type Fixtures,
} from './setup'

describe('RLS author_only — prospect_notes intra-workspace', () => {
  let userB: TestUser    // author of the note
  let userC: TestUser    // member of same workspace, NOT author
  let fixturesB: Fixtures

  beforeAll(async () => {
    userB    = await createTestUser('ao-b')
    fixturesB = await seedFixtures(userB.workspaceId, userB.userId)
    userC    = await addUserToWorkspace('ao-c', userB.workspaceId, 'member')
  }, 60_000)

  afterAll(async () => {
    await teardownTestUser(userC)
    await teardownTestUser(userB)
  }, 30_000)

  it('user C (same workspace, NOT author) cannot UPDATE user B note', async () => {
    const { data } = await userC.authedClient
      .from('prospect_notes')
      .update({ content: 'hacked by C' })
      .eq('id', fixturesB.prospectNoteId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('user C cannot DELETE user B note', async () => {
    const { data } = await userC.authedClient
      .from('prospect_notes')
      .delete()
      .eq('id', fixturesB.prospectNoteId)
      .select()
    expect(data?.length ?? 0).toBe(0)
  })

  it('user C CAN SELECT user B note (workspace member can read all notes)', async () => {
    const { data } = await userC.authedClient
      .from('prospect_notes')
      .select('id, content')
      .eq('id', fixturesB.prospectNoteId)
    expect(data?.length ?? 0).toBe(1)
  })

  it('user B (author) CAN UPDATE own note', async () => {
    const { data } = await userB.authedClient
      .from('prospect_notes')
      .update({ content: 'updated by B' })
      .eq('id', fixturesB.prospectNoteId)
      .select()
    expect(data?.length).toBe(1)
    expect(data?.[0].content).toBe('updated by B')
  })
})
