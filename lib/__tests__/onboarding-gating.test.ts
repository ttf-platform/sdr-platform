import { describe, it, expect } from 'vitest'
import { shouldSendOnboarding } from '../../app/api/cron/onboarding-emails/route'

// Convenience : merge sane defaults with the assertion-specific overrides.
// Defaults represent the "would send" happy path for the given offset :
//   - alreadySent = false, subscribed = false
//   - daysSinceSignup === offset (inside the [offset, offset+1] window)
//   - no signal, no launched campaign
function input(overrides: Partial<Parameters<typeof shouldSendOnboarding>[0]>) {
  return shouldSendOnboarding({
    offset:              0,
    alreadySent:         false,
    subscriptionActive:  false,
    daysSinceSignup:     0,
    hasActiveSignal:     false,
    hasLaunchedCampaign: false,
    ...overrides,
  })
}

describe('shouldSendOnboarding — behavioural gates (new in PR3)', () => {
  describe('d2 skip when a signal is already active', () => {
    it('skips d2 with reason=signal_already_set when hasActiveSignal', () => {
      expect(input({ offset: 2, daysSinceSignup: 2, hasActiveSignal: true }))
        .toEqual({ send: false, skipReason: 'signal_already_set' })
    })

    it('sends d2 when no signal is active AND inside the window', () => {
      expect(input({ offset: 2, daysSinceSignup: 2, hasActiveSignal: false }))
        .toEqual({ send: true })
    })

    it('sends d2 when no signal is active AND on the +1 tolerance day', () => {
      expect(input({ offset: 2, daysSinceSignup: 3, hasActiveSignal: false }))
        .toEqual({ send: true })
    })
  })

  describe('d7 skip when a campaign is already launched', () => {
    it('skips d7 with reason=campaign_already_launched when hasLaunchedCampaign', () => {
      expect(input({ offset: 7, daysSinceSignup: 7, hasLaunchedCampaign: true }))
        .toEqual({ send: false, skipReason: 'campaign_already_launched' })
    })

    it('sends d7 when no campaign has been launched AND inside the window', () => {
      expect(input({ offset: 7, daysSinceSignup: 7, hasLaunchedCampaign: false }))
        .toEqual({ send: true })
    })
  })

  describe('d0 is never gated by activity signals', () => {
    it('sends d0 even when both a signal AND a campaign already exist', () => {
      expect(input({
        offset: 0,
        daysSinceSignup: 0,
        hasActiveSignal: true,
        hasLaunchedCampaign: true,
      })).toEqual({ send: true })
    })
  })

  describe('d4 is never gated by activity signals (deliverability content, not a task nudge)', () => {
    it('sends d4 even when both a signal AND a campaign already exist', () => {
      expect(input({
        offset: 4,
        daysSinceSignup: 4,
        hasActiveSignal: true,
        hasLaunchedCampaign: true,
      })).toEqual({ send: true })
    })
  })
})

describe('shouldSendOnboarding — pre-existing skip reasons preserved', () => {
  it('short-circuits on already_sent regardless of window / activity', () => {
    // Even a perfect-window d0 with no activity gets skipped when the
    // idempotency row already exists.
    expect(input({ offset: 0, alreadySent: true, daysSinceSignup: 0 }))
      .toEqual({ send: false, skipReason: 'already_sent' })
    // And already_sent wins over the behavioural gates too.
    expect(input({ offset: 2, alreadySent: true, hasActiveSignal: true, daysSinceSignup: 2 }))
      .toEqual({ send: false, skipReason: 'already_sent' })
  })

  it('subscribed skips day 2/4/7 for active subscribers', () => {
    expect(input({ offset: 2, subscriptionActive: true, daysSinceSignup: 2 }))
      .toEqual({ send: false, skipReason: 'subscribed' })
    expect(input({ offset: 4, subscriptionActive: true, daysSinceSignup: 4 }))
      .toEqual({ send: false, skipReason: 'subscribed' })
    expect(input({ offset: 7, subscriptionActive: true, daysSinceSignup: 7 }))
      .toEqual({ send: false, skipReason: 'subscribed' })
  })

  it('subscribed does NOT block d0 (welcome email fires on signup day)', () => {
    // d0 goes out on day 0, before any subscription state has changed —
    // but even in a hypothetical race where the user is already active,
    // the welcome email is still expected to fire.
    expect(input({ offset: 0, subscriptionActive: true, daysSinceSignup: 0 }))
      .toEqual({ send: true })
  })

  it('out_of_window when too early', () => {
    expect(input({ offset: 4, daysSinceSignup: 3 }))
      .toEqual({ send: false, skipReason: 'out_of_window' })
  })

  it('out_of_window when too late (past offset + 1)', () => {
    expect(input({ offset: 4, daysSinceSignup: 6 }))
      .toEqual({ send: false, skipReason: 'out_of_window' })
  })

  it('accepts both offset and offset+1 days as in-window', () => {
    expect(input({ offset: 4, daysSinceSignup: 4 })).toEqual({ send: true })
    expect(input({ offset: 4, daysSinceSignup: 5 })).toEqual({ send: true })
  })
})

describe('shouldSendOnboarding — skip reason precedence (order matters)', () => {
  it('already_sent trumps subscribed', () => {
    expect(input({ offset: 2, alreadySent: true, subscriptionActive: true, daysSinceSignup: 2 }))
      .toEqual({ send: false, skipReason: 'already_sent' })
  })

  it('subscribed trumps out_of_window', () => {
    expect(input({ offset: 2, subscriptionActive: true, daysSinceSignup: 999 }))
      .toEqual({ send: false, skipReason: 'subscribed' })
  })

  it('out_of_window trumps signal_already_set', () => {
    // A user who is out of window AND has a signal should be logged as
    // out_of_window, not as signal_already_set — the window check runs
    // first so operators know "we didn't reach this workspace today"
    // rather than "we skipped because they were already active".
    expect(input({ offset: 2, daysSinceSignup: 999, hasActiveSignal: true }))
      .toEqual({ send: false, skipReason: 'out_of_window' })
  })

  it('out_of_window trumps campaign_already_launched', () => {
    expect(input({ offset: 7, daysSinceSignup: 999, hasLaunchedCampaign: true }))
      .toEqual({ send: false, skipReason: 'out_of_window' })
  })
})
