/**
 * Win-back delay + cutoff computation.
 *
 * The cron scans workspaces with subscription_status='canceled' and a
 * canceled_at older than the returned cutoff — i.e. workspaces that
 * cancelled at least WINBACK_DELAY_DAYS ago. The J+30 purge cron removes
 * rows canceled_at + 30d, so anything past that day is already gone from
 * the workspaces table ; no upper bound needed.
 *
 * Lives in lib/ (not in the route.ts) because Next.js rejects non-route
 * exports on files under app/api route handlers — same pattern as
 * lib/onboarding-gating.ts and lib/dunning.ts. Also makes the cutoff
 * unit-testable without spinning up the route.
 */

export const WINBACK_DELAY_DAYS = 23

const MS_PER_DAY = 86_400_000

/**
 * ISO timestamp for `now - WINBACK_DELAY_DAYS` days. The cron queries
 * workspaces.canceled_at <= this value, so any row whose canceled_at is on
 * or before the cutoff is eligible for the win-back nudge (subject to the
 * lifecycle_emails UNIQUE dedup + the purge safety net).
 */
export function winbackCutoffIso(nowMs: number): string {
  return new Date(nowMs - WINBACK_DELAY_DAYS * MS_PER_DAY).toISOString()
}
