// lib/billing-period.ts
//
// Single source of truth for the monthly-usage window. Anchors on the Stripe
// billing period when the workspace is on a paid subscription, and falls
// back to the calendar month for trial / cancelled / no-sub states.
//
// Contract:
//   - Return type is always { start, end } as ISO date strings YYYY-MM-DD.
//     Callers writing to usage_tracking.period_start (DATE column) plug the
//     `start` string directly. Callers filtering reads use `.gte('period_start', start)`.
//     Callers displaying a reset date to the user surface `end`.
//
//   - All internal math is UTC. Using Date#setDate / #setHours would inherit
//     the runtime's local timezone and drift by ±1 day around DST or month
//     borders on servers not aligned to Europe/Paris. Vercel runs UTC and
//     users can live anywhere — the DATE column in Postgres is timezone-less,
//     so the only safe reference frame is UTC.
//
// Semantics of ws.current_period_start / end:
//   - Populated by the Stripe webhook (subscription.created / updated) ONLY
//     when the subscription status is 'active' or 'past_due'. Any other
//     status ('trialing', 'canceled', 'incomplete', 'unpaid', 'deleted')
//     nulls both columns. See app/api/stripe/webhook/route.ts.
//
//   - null → paid window is not defined for this workspace → use calendar
//     fallback. This preserves the previous behaviour for trials and any
//     legacy workspace whose columns have not yet been populated by a
//     subscription.updated event.

export type BillingPeriod = {
  start: string  // 'YYYY-MM-DD'
  end:   string  // 'YYYY-MM-DD'
}

export type WorkspacePeriodInput = {
  current_period_start?: string | null
  current_period_end?:   string | null
}

/**
 * Compute the monthly-usage window for a workspace.
 *
 * - When ws.current_period_start and ws.current_period_end are both set
 *   (paid subscription): return the Stripe-anchored window verbatim.
 * - Otherwise: return the calendar month in UTC.
 *
 * `now` is injected for tests. Production callers should omit it and let
 * the function use the current wall clock.
 */
export function getUsagePeriod(
  ws: WorkspacePeriodInput | null | undefined,
  now: Date = new Date(),
): BillingPeriod {
  if (ws?.current_period_start && ws?.current_period_end) {
    return {
      start: ws.current_period_start,
      end:   ws.current_period_end,
    }
  }
  return calendarMonthUtc(now)
}

/**
 * Calendar-month fallback in UTC. First-of-month → first-of-next-month.
 * Exposed for tests and for any caller that needs the pure fallback.
 */
export function calendarMonthUtc(now: Date = new Date()): BillingPeriod {
  const year  = now.getUTCFullYear()
  const month = now.getUTCMonth()  // 0-indexed
  const start = new Date(Date.UTC(year, month,     1))
  const end   = new Date(Date.UTC(year, month + 1, 1))
  return {
    start: start.toISOString().slice(0, 10),
    end:   end.toISOString().slice(0, 10),
  }
}
