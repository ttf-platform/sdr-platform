import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Test scope ─────────────────────────────────────────────────────────────
//
// B1 assertion : the draft-generation batch insert no longer uses the
// `onConflict` upsert (that arbitration cannot be inferred on a PARTIAL
// unique index — 42P10 systematically after migration 089) and instead
// uses a plain .insert() that swallows the residual 23505 race artifact
// coming from the partial unique index on (prospect_id, campaign_step_id)
// WHERE origin='campaign'.
//
// Two cases :
//   Happy path — insert returns no error → generator returns success.
//   Race path  — insert returns 23505 (concurrent generation won) → we
//                still return success (warning-logged, no user-facing 500).

const {
  campaignSelectMock,
  profileSelectMock,
  stepsSelectMock,
  prospectsSelectMock,
  existingSelectMock,
  peInsertMock,
  campaignsUpdateMock,
  loggedAiCallMock,
} = vi.hoisted(() => ({
  campaignSelectMock:  vi.fn(),
  profileSelectMock:   vi.fn(),
  stepsSelectMock:     vi.fn(),
  prospectsSelectMock: vi.fn(),
  existingSelectMock:  vi.fn(),
  peInsertMock:        vi.fn(),
  campaignsUpdateMock: vi.fn(),
  loggedAiCallMock:    vi.fn(),
}))

vi.mock('@/lib/anthropic', () => ({
  // getAnthropicClient() is called eagerly at l.196 ; mode='fast' + step_order=0
  // never actually invokes messages.create so we just need an object.
  getAnthropicClient: () => ({ messages: { create: vi.fn() } }),
}))

vi.mock('@/lib/ai-cost', () => ({
  logAiCall: loggedAiCallMock,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'campaigns') {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ single: campaignSelectMock }) }),
          }),
          // personalization_mode update at end of function
          update: () => ({
            eq: () => ({ eq: campaignsUpdateMock }),
          }),
        }
      }
      if (table === 'workspace_profiles') {
        return {
          select: () => ({
            eq: () => ({ single: profileSelectMock }),
          }),
        }
      }
      if (table === 'campaign_steps') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ order: stepsSelectMock }),
            }),
          }),
        }
      }
      if (table === 'prospects') {
        // .select().eq('campaign_id').eq('workspace_id') — no order/limit
        return {
          select: () => ({
            eq: () => ({ eq: prospectsSelectMock }),
          }),
        }
      }
      if (table === 'prospect_emails') {
        return {
          // Dedup pre-check : .select().eq().eq().in().in() → array
          //                   (post-B1 : now .select().eq().eq(origin).in().in())
          select: () => ({
            eq: () => ({ eq: () => ({ in: () => ({ in: existingSelectMock }) }) }),
          }),
          // Insert path : plain .insert(rows)
          insert: peInsertMock,
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { generateDraftsForCampaign } from '@/lib/draft-generation'

const WS_ID       = '11111111-1111-1111-1111-111111111111'
const CAMPAIGN_ID = '22222222-2222-2222-2222-222222222222'
const STEP_ID     = '33333333-3333-3333-3333-333333333333'
const PROSPECT_ID = '44444444-4444-4444-4444-444444444444'
const CONTACT_ID  = '55555555-5555-5555-5555-555555555555'

beforeEach(() => {
  vi.clearAllMocks()

  campaignSelectMock.mockResolvedValue({
    data: {
      id:                            CAMPAIGN_ID,
      target_persona:                'CTO',
      angle:                         'save time',
      value_prop:                    'automate outbound',
      cta:                           'Interested?',
      proof_points:                  null,
      include_booking_link_initial:  false,
      target_industry:               null,
      target_titles:                 null,
      target_regions:                null,
      company_sizes:                 null,
      company_revenue:               null,
      tone:                          null,
      language:                      'en',
    },
    error: null,
  })

  profileSelectMock.mockResolvedValue({
    data: {
      sender_name:           'Max',
      user_name:             'Max',
      company_name:          'Mirvo',
      product_description:   null,
      value_proposition:     null,
      tone:                  null,
      icp_description:       null,
      icp_industries:        null,
      pain_points:           null,
      icp_company_size:      null,
      booking_slug:          null,
      booking_config:        {},
      user_title:            null,
      company_website:       null,
      email_signature:       null,
      signature_in_initial:  false,
      signature_in_followups:false,
    },
    error: null,
  })

  stepsSelectMock.mockResolvedValue({
    data: [
      {
        id:         STEP_ID,
        step_order: 0,
        step_type:  'initial',
        subject:    'Hey {{first_name}}',
        body:       'Body for {{company}}',
      },
    ],
    error: null,
  })

  prospectsSelectMock.mockResolvedValue({
    data: [
      {
        id:          PROSPECT_ID,
        contact_id:  CONTACT_ID,
        contacts: {
          first_name:   'Ada',
          last_name:    'Lovelace',
          company:      'Acme',
          title:        'CTO',
          industry:     null,
          company_size: null,
          location:     null,
          linkedin_url: null,
        },
      },
    ],
    error: null,
  })

  existingSelectMock.mockResolvedValue({ data: [], error: null })
  campaignsUpdateMock.mockResolvedValue({ data: null, error: null })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('generateDraftsForCampaign — B1 : .insert() (no onConflict) + 23505-absorbed', () => {
  it('happy path : .insert() succeeds → generator returns success with generated_count=1', async () => {
    peInsertMock.mockResolvedValue({ data: null, error: null })

    const result = await generateDraftsForCampaign(CAMPAIGN_ID, WS_ID, 'fast')

    expect(peInsertMock).toHaveBeenCalledTimes(1)
    const insertedRows = peInsertMock.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(Array.isArray(insertedRows)).toBe(true)
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]).toMatchObject({
      workspace_id:     WS_ID,
      prospect_id:      PROSPECT_ID,
      campaign_step_id: STEP_ID,
      status:           'draft',
    })
    // The row MUST NOT set origin explicitly — the default 'campaign' from
    // migration 088 applies. Test the contract negatively so a future
    // accidental origin='inbox_reply' on this path fails loudly.
    expect(insertedRows[0]).not.toHaveProperty('origin')

    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.generated_count).toBe(1)
      expect(result.skipped_existing).toBe(0)
    }
  })

  it('race path : .insert() returns 23505 → generator absorbs it and returns success (not 500)', async () => {
    // Simulate a concurrent generate-drafts call that inserted the same
    // rows between our SELECT dedup and this INSERT. Partial unique index
    // rejects with 23505.
    peInsertMock.mockResolvedValue({
      data:  null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "prospect_emails_prospect_id_campaign_step_id_campaign_uniq"' },
    })

    const result = await generateDraftsForCampaign(CAMPAIGN_ID, WS_ID, 'fast')

    // Insert was called once (no onConflict retry loop).
    expect(peInsertMock).toHaveBeenCalledTimes(1)
    // Function returns success (GenerateResult), NOT a { error, status: 500 }
    // shape — the whole point of B1 is that a concurrency artifact does
    // not become a user-facing 500.
    expect('error' in result).toBe(false)
  })

  it('other DB errors on insert (not 23505) still surface as { error, status: 500 }', async () => {
    peInsertMock.mockResolvedValue({
      data:  null,
      error: { code: '42P10', message: 'no unique or exclusion constraint matching the ON CONFLICT specification' },
    })

    const result = await generateDraftsForCampaign(CAMPAIGN_ID, WS_ID, 'fast')

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.status).toBe(500)
      expect(result.error).toContain('no unique or exclusion constraint')
    }
  })
})
