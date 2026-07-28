import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Route-level test for GET /api/book/[slug]/prospect/[id] ──────────────
//
// Locks down that first_name / last_name / company come from the contacts
// embed. Pre-fix the select() requested those columns directly on the
// `prospects` table (they were extracted to `contacts` by migration 013),
// PostgREST rejected the whole query, and the data-only destructure
// silently returned { name: '', company: '' } for a valid link — the form
// appeared unpopulated with no 404 or error surface.

const {
  rateLimitMock,
  profileSelectSingleMock,
  prospectSelectSingleMock,
} = vi.hoisted(() => ({
  rateLimitMock:            vi.fn(),
  profileSelectSingleMock:  vi.fn(),
  prospectSelectSingleMock: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimitByIp: rateLimitMock,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'workspace_profiles') {
        return {
          select: () => ({
            eq: () => ({ single: profileSelectSingleMock }),
          }),
        }
      }
      if (table === 'prospects') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ single: prospectSelectSingleMock }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { GET } from '@/app/api/book/[slug]/prospect/[id]/route'

const WS_ID       = '11111111-1111-1111-1111-111111111111'
const PROSPECT_ID = '44444444-4444-4444-4444-444444444444'
const SLUG        = 'acme'

function makeReq() {
  return new Request(`http://x/api/book/${SLUG}/prospect/${PROSPECT_ID}`, {
    method: 'GET',
  })
}
const params = Promise.resolve({ slug: SLUG, id: PROSPECT_ID })

beforeEach(() => {
  vi.clearAllMocks()
  rateLimitMock.mockResolvedValue({ allowed: true })
  profileSelectSingleMock.mockResolvedValue({
    data:  { workspace_id: WS_ID },
    error: null,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/book/[slug]/prospect/[id] — contacts-join fix', () => {
  it('returns name + company populated from the embedded contacts row', async () => {
    prospectSelectSingleMock.mockResolvedValue({
      data: {
        contacts: {
          first_name: 'Ada',
          last_name:  'Lovelace',
          company:    'Acme',
        },
      },
      error: null,
    })

    const res = await GET(makeReq(), { params })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ name: 'Ada Lovelace', company: 'Acme' })
  })
})
