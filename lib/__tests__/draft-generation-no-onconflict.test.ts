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

describe('generateDraftsForCampaign — B1 : .insert() (no onConflict) + per-row race fallback', () => {
  it('happy path (1 prospect) : batch .insert() succeeds → single round-trip, generated_count=1', async () => {
    peInsertMock.mockResolvedValue({ data: null, error: null })

    const result = await generateDraftsForCampaign(CAMPAIGN_ID, WS_ID, 'fast')

    // Happy path invariant : ONE round-trip only. Per-row fallback never
    // touched.
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

  it('THE brief-mandated case : batch of 3, one pair collides mid-batch → generated_count=2 AND actual per-row calls verified', async () => {
    // Setup : 3 prospects on 1 step → insertRows.length = 3.
    // Postgres is atomic per statement : the batch INSERT is rejected
    // wholesale by a single row's 23505. Naive absorption would drop
    // all 3 rows while reporting generated_count = 3 — the exact lie
    // this test blocks.
    //
    // Fallback shape : the code retries per-row. We assert :
    //   (a) the batch insert was called (1 call, 3 rows)
    //   (b) exactly 3 per-row inserts followed (each carrying 1 row)
    //   (c) generated_count reflects ACTUAL successes (2 in this case)
    const P1 = '44444444-4444-4444-4444-000000000001'
    const P2 = '44444444-4444-4444-4444-000000000002'
    const P3 = '44444444-4444-4444-4444-000000000003'

    prospectsSelectMock.mockResolvedValue({
      data: [P1, P2, P3].map((id, i) => ({
        id,
        contact_id:  `55555555-5555-5555-5555-00000000000${i + 1}`,
        contacts: {
          first_name: `First${i}`, last_name: `Last${i}`,
          company: 'Acme', title: 'CTO',
          industry: null, company_size: null, location: null, linkedin_url: null,
        },
      })),
      error: null,
    })

    // Insert call sequence (real code path) :
    //   Call 1 — batch of 3 → 23505 (atomic rejection because one row collides)
    //   Call 2 — per-row P1 → OK
    //   Call 3 — per-row P2 → 23505 (this is the colliding pair — race with a
    //            parallel generate-drafts that inserted P2 between our dedup
    //            SELECT and this batch)
    //   Call 4 — per-row P3 → OK
    //
    // generated_count MUST be 2 (only P1 and P3 landed), not 3 (would lie
    // by treating a swallowed batch as a success).
    peInsertMock
      .mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint "prospect_emails_prospect_step_campaign_uniq"' },
      })
      .mockResolvedValueOnce({ data: null, error: null })  // P1 OK
      .mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint "prospect_emails_prospect_step_campaign_uniq"' },
      })
      .mockResolvedValueOnce({ data: null, error: null })  // P3 OK

    const result = await generateDraftsForCampaign(CAMPAIGN_ID, WS_ID, 'fast')

    // (a) Batch call was first.
    expect(peInsertMock).toHaveBeenCalledTimes(4)
    const batchCall = peInsertMock.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(Array.isArray(batchCall)).toBe(true)
    expect(batchCall).toHaveLength(3)

    // (b) The 3 subsequent calls each carry 1 row, and the prospect_ids
    //     match the batch verbatim (order preserved).
    for (let i = 1; i <= 3; i++) {
      const rowCall = peInsertMock.mock.calls[i][0] as Record<string, unknown>
      expect(Array.isArray(rowCall)).toBe(false)
      expect(rowCall).toMatchObject({
        prospect_id:      batchCall[i - 1].prospect_id,
        campaign_step_id: batchCall[i - 1].campaign_step_id,
        workspace_id:     WS_ID,
      })
    }

    // (c) generated_count MUST reflect actual successes (2), never
    //     insertRows.length (3). This is the invariant the brief flagged.
    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.generated_count).toBe(2)
      // The 3rd prospect (P2 collision) is not lost data — a parallel
      // generate-drafts inserted it with the same content by construction.
      // We don't count it as "skipped_existing" because that field is for
      // the applicative pre-check (rows we knew about via existingSet),
      // not for post-hoc race artifacts.
      expect(result.skipped_existing).toBe(0)
    }
  })

  it('race path (1 prospect) : batch 23505 → per-row also 23505 → generated_count=0 (not lied to as 1)', async () => {
    // Simulate a concurrent generate-drafts call that already inserted the
    // only row we were about to insert. Batch fails ; per-row (single item)
    // also 23505. generated_count MUST be 0.
    peInsertMock
      .mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint "prospect_emails_prospect_step_campaign_uniq"' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint "prospect_emails_prospect_step_campaign_uniq"' },
      })

    const result = await generateDraftsForCampaign(CAMPAIGN_ID, WS_ID, 'fast')

    expect(peInsertMock).toHaveBeenCalledTimes(2)  // batch + 1 per-row
    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.generated_count).toBe(0)  // was 1 pre-fix → the lie
    }
  })

  it('other DB errors on batch insert (not 23505) still surface as { error, status: 500 } without per-row fallback', async () => {
    peInsertMock.mockResolvedValue({
      data:  null,
      error: { code: '42P10', message: 'no unique or exclusion constraint matching the ON CONFLICT specification' },
    })

    const result = await generateDraftsForCampaign(CAMPAIGN_ID, WS_ID, 'fast')

    // Only the batch call — no per-row retry on non-23505 errors.
    expect(peInsertMock).toHaveBeenCalledTimes(1)
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.status).toBe(500)
      expect(result.error).toContain('no unique or exclusion constraint')
    }
  })

  it('per-row insert hits a NON-23505 error mid-fallback → surfaced, not silently dropped', async () => {
    // The core invariant : during per-row fallback, ANY error other than
    // 23505 surfaces as { error, status: 500 }. Silently dropping N-1
    // rows because of an unrelated per-row DB regression (NOT NULL, RLS)
    // is exactly the class of bug this PR closes for its parent.
    const P1 = '44444444-4444-4444-4444-000000000011'
    const P2 = '44444444-4444-4444-4444-000000000012'

    prospectsSelectMock.mockResolvedValue({
      data: [P1, P2].map((id, i) => ({
        id,
        contact_id:  `55555555-5555-5555-5555-00000000001${i + 1}`,
        contacts: {
          first_name: `First${i}`, last_name: `Last${i}`,
          company: 'Acme', title: 'CTO',
          industry: null, company_size: null, location: null, linkedin_url: null,
        },
      })),
      error: null,
    })

    peInsertMock
      .mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'batch collision on one pair' },
      })
      .mockResolvedValueOnce({ data: null, error: null })  // P1 OK
      .mockResolvedValueOnce({
        data: null,
        error: { code: '23502', message: 'null value in column violates not-null constraint' },
      })

    const result = await generateDraftsForCampaign(CAMPAIGN_ID, WS_ID, 'fast')

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.status).toBe(500)
      expect(result.error).toContain('null value in column')
    }
  })
})
