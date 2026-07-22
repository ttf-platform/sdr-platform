import type { OnboardingDayOffset } from '@/lib/email'

/**
 * Pure decision function : should this (workspace, offset) combination be
 * sent right now ? Extracted so unit tests can exercise the branching
 * without a Supabase double.
 *
 * Order matters — the first matching skip reason short-circuits :
 *   1. `already_sent`               — idempotency (existing behavior)
 *   2. `subscribed`                 — day 2/4/7 skipped for active subscribers (existing)
 *   3. `out_of_window`              — target day ± 1 tolerance (existing)
 *   4. `signal_already_set` (d2)    — user already configured a signal → the d2 nudge is redundant
 *   5. `campaign_already_launched` (d7) — user already launched a campaign → the d7 nudge is redundant
 *
 * Best-practice "just-in-time" onboarding : never nudge an action the user
 * has already done. d0 (welcome) is never gated by activity ; d4
 * (deliverability education) is content, not a task, so it also stays
 * ungated.
 *
 * Lives here (not in the route.ts) because Next.js rejects non-route
 * exports on files under app/api route handlers — moving the pure fn to
 * lib/ keeps prod builds green while preserving unit-test access.
 */
export type OnboardingSkipReason =
  | 'already_sent'
  | 'subscribed'
  | 'out_of_window'
  | 'signal_already_set'
  | 'campaign_already_launched'

export function shouldSendOnboarding(p: {
  offset:              OnboardingDayOffset
  alreadySent:         boolean
  subscriptionActive:  boolean
  daysSinceSignup:     number
  hasActiveSignal:     boolean
  hasLaunchedCampaign: boolean
}): { send: boolean; skipReason?: OnboardingSkipReason } {
  if (p.alreadySent) return { send: false, skipReason: 'already_sent' }
  if (p.offset > 0 && p.subscriptionActive) return { send: false, skipReason: 'subscribed' }
  if (p.daysSinceSignup < p.offset || p.daysSinceSignup > p.offset + 1) {
    return { send: false, skipReason: 'out_of_window' }
  }
  if (p.offset === 2 && p.hasActiveSignal)     return { send: false, skipReason: 'signal_already_set' }
  if (p.offset === 7 && p.hasLaunchedCampaign) return { send: false, skipReason: 'campaign_already_launched' }
  return { send: true }
}
