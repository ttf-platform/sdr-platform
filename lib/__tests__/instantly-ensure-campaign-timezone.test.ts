/**
 * Regression — the Instantly campaigns endpoint refuses Europe/Paris on
 * campaign_schedule.schedules[0].timezone. Measured in prod 2026-08-09 :
 *   POST https://api.instantly.ai/api/v2/campaigns → HTTP 400
 *   { statusCode:400, error:"Bad Request",
 *     message:"body/campaign_schedule/schedules/0/timezone must be equal
 *              to one of the allowed values" }
 *
 * The provider list is closed and does not include Europe/Paris. The
 * business timezone Mirvo stores stays Europe/Paris ; only the value
 * transmitted to the vendor is translated. Europe/Belgrade is DST-aligned
 * with Europe/Paris (measured : 0 offset divergence over 26 280 hours from
 * 2025-01-01 to 2028-01-01, Node 22.22.2, ICU 78.2). Any other timezone
 * value is transmitted unchanged.
 *
 * This test is hermetic : globalThis.fetch is stubbed via vi.stubGlobal ;
 * any URL other than the campaigns endpoint makes the stub throw so a
 * silent drift fails the test instead of leaking to the network. No env
 * var is read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InstantlyProvider } from '../email-provider-adapter'

const CAMPAIGNS_URL = 'https://api.instantly.ai/api/v2/campaigns'

type Captured = { url: string; body: unknown }

function installFetchStub(captured: Captured[]) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : (input as Request).url

    if (url !== CAMPAIGNS_URL) {
      throw new Error(`unexpected fetch during ensureCampaign test: ${url}`)
    }

    const rawBody = init?.body
    let parsed: unknown = null
    if (typeof rawBody === 'string') {
      try { parsed = JSON.parse(rawBody) } catch { parsed = null }
    }
    captured.push({ url, body: parsed })

    // parseBody() reads res.text() and JSON.parses it. The response body
    // MUST carry an `id` field, otherwise ensureCampaign throws
    // "response missing campaign id" before our assertion can run.
    const responseBody = JSON.stringify({ id: 'camp_test_abc' })
    return {
      ok: true,
      status: 200,
      text: async () => responseBody,
    } as unknown as Response
  })
}

const baseParams = {
  name: 'Test Campaign',
  senderEmail: 'sender@example.com',
  senderName:  'Sender Name',
} as const

const parisSchedule = {
  windowStart: '08:00',
  windowEnd:   '18:00',
  days:        [1, 2, 3, 4, 5],
  timezone:    'Europe/Paris',
}

const londonSchedule = {
  windowStart: '08:00',
  windowEnd:   '18:00',
  days:        [1, 2, 3, 4, 5],
  timezone:    'Europe/London',
}

describe('InstantlyProvider.ensureCampaign — timezone substitution', () => {
  let captured: Captured[]

  beforeEach(() => {
    captured = []
    installFetchStub(captured)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('substitutes Europe/Paris with Europe/Belgrade in the payload sent to the provider', async () => {
    const provider = new InstantlyProvider('test-api-key')
    await provider.ensureCampaign({ ...baseParams, schedule: parisSchedule })

    expect(captured).toHaveLength(1)
    const body = captured[0].body as {
      campaign_schedule?: { schedules?: Array<{ timezone?: string }> }
    }
    const sentTimezone = body?.campaign_schedule?.schedules?.[0]?.timezone
    expect(sentTimezone).toBe('Europe/Belgrade')
  })

  it('transmits any other timezone unchanged (no general lookup table)', async () => {
    const provider = new InstantlyProvider('test-api-key')
    await provider.ensureCampaign({ ...baseParams, schedule: londonSchedule })

    expect(captured).toHaveLength(1)
    const body = captured[0].body as {
      campaign_schedule?: { schedules?: Array<{ timezone?: string }> }
    }
    const sentTimezone = body?.campaign_schedule?.schedules?.[0]?.timezone
    expect(sentTimezone).toBe('Europe/London')
  })
})
