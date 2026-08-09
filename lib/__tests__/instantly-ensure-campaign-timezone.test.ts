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

// Not `as const` : sendingMailboxes needs to be a mutable string[] to
// satisfy EnsureCampaignParams. A readonly tuple from `as const` would
// break the type check on the existing call sites.
const baseParams = {
  name: 'Test Campaign',
  senderEmail: 'sender@example.com',
  senderName:  'Sender Name',
  sendingMailboxes: ['mailbox-a@mirvo.test', 'mailbox-b@mirvo.test'],
}

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

// ─── email_list + sequences on the create-campaign payload ─────────────────
//
// Measured in prod 2026-08-09 : the campaign Mirvo currently creates carries
// neither "sequences" nor "email_list". A campaign carrying both (email_list
// = the workspace mailboxes ; sequences = one email step, delay 0, one
// variant with subject={{mirvo_subject}} + body={{mirvo_body}}) was observed
// emitting a real message received in inbox. Instantly does not surface these
// fields on the create response, so the only way to catch a regression is
// by asserting on the request body.
describe('InstantlyProvider.ensureCampaign — email_list and sequences payload', () => {
  let captured: Captured[]

  beforeEach(() => {
    captured = []
    installFetchStub(captured)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards sendingMailboxes verbatim as email_list', async () => {
    const provider = new InstantlyProvider('test-api-key')
    await provider.ensureCampaign({
      ...baseParams,
      schedule: parisSchedule,
      sendingMailboxes: ['a@mirvo.test', 'b@mirvo.test', 'c@mirvo.test'],
    })

    expect(captured).toHaveLength(1)
    const body = captured[0].body as { email_list?: unknown }
    expect(body.email_list).toEqual(['a@mirvo.test', 'b@mirvo.test', 'c@mirvo.test'])
  })

  it('carries a sequences[0] with exactly one email step, delay 0, and one variant', async () => {
    const provider = new InstantlyProvider('test-api-key')
    await provider.ensureCampaign({ ...baseParams, schedule: parisSchedule })

    expect(captured).toHaveLength(1)
    const body = captured[0].body as {
      sequences?: Array<{
        steps?: Array<{
          type?:     string
          delay?:    number
          variants?: Array<{ subject?: string; body?: string }>
        }>
      }>
    }
    expect(Array.isArray(body.sequences)).toBe(true)
    expect(body.sequences).toHaveLength(1)

    const steps = body.sequences?.[0]?.steps
    expect(Array.isArray(steps)).toBe(true)
    expect(steps).toHaveLength(1)
    expect(steps?.[0]?.type).toBe('email')
    expect(steps?.[0]?.delay).toBe(0)

    const variants = steps?.[0]?.variants
    expect(Array.isArray(variants)).toBe(true)
    expect(variants).toHaveLength(1)
  })

  it('sets the sole variant subject to the literal {{mirvo_subject}} marker', async () => {
    const provider = new InstantlyProvider('test-api-key')
    await provider.ensureCampaign({ ...baseParams, schedule: parisSchedule })

    const body = captured[0].body as {
      sequences?: Array<{ steps?: Array<{ variants?: Array<{ subject?: string }> }> }>
    }
    const subject = body.sequences?.[0]?.steps?.[0]?.variants?.[0]?.subject
    expect(subject).toBe('{{mirvo_subject}}')
  })

  it('sets the sole variant body to the literal {{mirvo_body}} marker', async () => {
    const provider = new InstantlyProvider('test-api-key')
    await provider.ensureCampaign({ ...baseParams, schedule: parisSchedule })

    const body = captured[0].body as {
      sequences?: Array<{ steps?: Array<{ variants?: Array<{ body?: string }> }> }>
    }
    const variantBody = body.sequences?.[0]?.steps?.[0]?.variants?.[0]?.body
    expect(variantBody).toBe('{{mirvo_body}}')
  })
})
