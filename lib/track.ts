import posthog from 'posthog-js'

export type TrackEvent =
  | { event: 'signup_completed';      properties: { plan: string } }
  | { event: 'trial_started';         properties: { plan: string; auto: boolean } }
  | { event: 'login_completed';       properties?: Record<string, unknown> }
  | { event: 'campaign_created';      properties: { campaign_id: string; has_steps: boolean } }
  | { event: 'subscription_created';  properties: { plan: string } }

export function track(e: TrackEvent['event'], properties?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  posthog.capture(e, properties)
}
