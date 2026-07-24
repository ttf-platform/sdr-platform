/**
 * lib/admin-metrics.ts — single source of truth for admin billing metrics.
 *
 * BEFORE this file existed, "paid / active / MRR" was recomputed at least
 * six different ways across the admin surface. Consolidation landed the
 * `subscription_status === 'active'` rule for "paid" everywhere.
 *
 * BUT `active` alone still overcounts revenue : a comped admin workspace
 * (`is_free_granted = true`) and a test / seeded workspace (Screenshots
 * bot, no `stripe_subscription_id`) both sit in `active` yet generate
 * zero real revenue. Prod snapshot before this PR : 2 workspaces `active`,
 * both without a Stripe subscription — MRR displayed at $698 was
 * entirely fictional.
 *
 * Two distinct concepts are now separated :
 *
 *   - `isActivePaid(ws)`  ≡ `subscription_status === 'active'`
 *     → "the workspace has ACCESS right now". Used by broadcast targeting,
 *       /api/admin/stats, PlanPill on /admin/users — comms and access
 *       affordances, not revenue.
 *
 *   - `isRealRevenue(ws)` ≡ active AND `stripe_subscription_id` set AND
 *                            `is_free_granted !== true`
 *     → "the workspace is paying real Stripe money right now". Used by
 *       aggregate MRR, /admin/revenue, /admin/analytics funnel + trial→paid.
 *
 * `aggregateBilling` uses BOTH : the per-status counters (active, trialing,
 * pastDue, canceled, expired) reflect ACCESS. `mrrTotal`, `paidCount`,
 * `unknownPlanActiveCount`, `intervalAssumedCount` reflect REAL REVENUE.
 * A dedicated `compedActiveCount` surfaces the gap (active but comped)
 * so /admin/overview can be transparent about the delta.
 *
 * Prices come from lib/pricing.ts → PLAN_PRICES (nothing redefined here).
 *
 * Per-row admin badges should use `billingLabel()` — the plan tier is
 * intentionally rendered separately (see PlanPill in
 * app/admin/users/_components/UsersListClient.tsx) : a canceled / expired
 * workspace still has a plan_tier value in the DB but must NOT be shown
 * with the "paid" pill.
 */

import { monthlyMrrForWorkspace } from '@/lib/pricing'

/**
 * Shared SELECT column list. Every admin route that consumes this helper
 * must select exactly these columns so a future column rename can be
 * caught by tsc rather than by the runtime discovering `undefined`.
 * Order matches lib/admin-metrics.ts::BillingRow.
 */
export const ADMIN_BILLING_COLUMNS =
  'id, plan_tier, subscription_status, billing_interval, trial_end_date, stripe_subscription_id, is_free_granted' as const

export interface BillingRow {
  plan_tier:               string | null
  subscription_status:     string | null
  // Optional because two admin call-sites (broadcast + stats) only need the
  // status predicate `isActivePaid` and never compute MRR. Full aggregation
  // via `aggregateBilling` / `workspaceMrr` / `isRealRevenue` still expects
  // every column below to be selected — an undefined `stripe_subscription_id`
  // or `is_free_granted` on a row passed into `isRealRevenue` will cause
  // it to return false (defensive : "not confirmed paying" beats "assumed
  // paying").
  billing_interval?:       string | null
  trial_end_date?:         string | null
  stripe_subscription_id?: string | null
  is_free_granted?:        boolean | null
}

/**
 * Truth predicate for "this workspace has ACCESS right now".
 * Deliberately excludes past_due : the workspace still owes money and the
 * MRR is unrecoverable until they settle up, matching Stripe's convention.
 *
 * NOTE : `isActivePaid` is NOT a revenue predicate. Comped admins and test
 * / seeded workspaces sit here too. For real revenue use `isRealRevenue`.
 */
export function isActivePaid(ws: BillingRow): boolean {
  return ws.subscription_status === 'active'
}

/**
 * Truth predicate for "this workspace is currently generating REAL revenue".
 * Requires all three :
 *   - `subscription_status === 'active'`   (has access)
 *   - `stripe_subscription_id` is set      (there's an actual Stripe sub
 *     invoicing them ; a test / seeded workspace won't have one)
 *   - `is_free_granted !== true`           (not a comped account — admin,
 *     partner, etc. get free grants that flip this column true)
 *
 * Used by MRR aggregation, /admin/revenue, /admin/analytics funnel and
 * trial → paid. Do NOT use for access / broadcast decisions — those still
 * want `isActivePaid` (a comped active workspace should still receive a
 * "paid" broadcast because they behave like a paying customer from a
 * product standpoint).
 */
export function isRealRevenue(ws: BillingRow): boolean {
  return (
    ws.subscription_status === 'active' &&
    !!ws.stripe_subscription_id        &&
    ws.is_free_granted !== true
  )
}

/**
 * Per-workspace MRR contribution. Delegates to lib/pricing.ts — nothing new
 * is defined here so a plan price change ripples through the entire admin
 * surface by editing PLAN_PRICES exactly once.
 */
export function workspaceMrr(ws: BillingRow): ReturnType<typeof monthlyMrrForWorkspace> {
  return monthlyMrrForWorkspace(ws.plan_tier, ws.billing_interval ?? null)
}

export interface BillingAggregate {
  total:                    number
  /** Access buckets — every workspace in a known subscription_status is counted here. */
  active:                   number
  trialing:                 number
  pastDue:                  number
  canceled:                 number
  expired:                  number
  /** Real-revenue count (isRealRevenue) — active AND Stripe sub set AND NOT comped. */
  paidCount:                number
  /** Active rows that are comped (is_free_granted === true). Surfaces the
   *  active↔paid gap for transparent admin reporting ; SHOULD equal
   *  `active - paidCount - (active rows with no stripe_sub)`. */
  compedActiveCount:        number
  mrrTotal:                 number
  /** Real-revenue rows whose plan_tier is not in PLAN_PRICES (excluded from mrrTotal). */
  unknownPlanActiveCount:   number
  /** Real-revenue rows whose billing_interval was null/unknown → treated as monthly. */
  intervalAssumedCount:     number
}

/**
 * Full aggregate over an array of workspace rows. Access counters
 * (`active`, `trialing`, `pastDue`, `canceled`, `expired`) reflect
 * `subscription_status` — used for status breakdowns, badges, and
 * "how many workspaces have access". Revenue counters (`paidCount`,
 * `mrrTotal`, `unknownPlanActiveCount`, `intervalAssumedCount`) reflect
 * `isRealRevenue` — comped and no-Stripe workspaces are excluded so the
 * numbers match "what Stripe will actually invoice this month".
 */
export function aggregateBilling(rows: BillingRow[]): BillingAggregate {
  const agg: BillingAggregate = {
    total:                  rows.length,
    active:                 0,
    trialing:               0,
    pastDue:                0,
    canceled:               0,
    expired:                0,
    paidCount:              0,
    compedActiveCount:      0,
    mrrTotal:               0,
    unknownPlanActiveCount: 0,
    intervalAssumedCount:   0,
  }

  for (const ws of rows) {
    switch (ws.subscription_status) {
      case 'active':   agg.active++;   break
      case 'trialing': agg.trialing++; break
      case 'past_due': agg.pastDue++;  break
      case 'canceled': agg.canceled++; break
      case 'expired':  agg.expired++;  break
      // any other value (null / unknown) contributes to `total` but no bucket
    }

    // Comped-active gap surface. Independent of `isRealRevenue` — an active
    // comped workspace also increments `active` above ; this counter
    // exposes the "how much of `active` is not actually paying" delta.
    if (ws.subscription_status === 'active' && ws.is_free_granted === true) {
      agg.compedActiveCount++
    }

    if (!isRealRevenue(ws)) continue

    agg.paidCount++

    const m = workspaceMrr(ws)
    if (!m) {
      agg.unknownPlanActiveCount++
      continue
    }
    agg.mrrTotal += m.mrr_usd
    if (m.interval_assumed_monthly) agg.intervalAssumedCount++
  }

  return agg
}

/**
 * 30-day subscription churn rate, as a percentage.
 *
 * churned      = rows with subscription_status === 'canceled' AND canceled_at
 *                set AND (nowMs - canceled_at) < 30 days.
 * activePaying = rows with subscription_status === 'active'.
 * base         = activePaying + churned  (paying customers at the start of the
 *                window, approximated by "still paying now" + "canceled within
 *                the window").
 *
 * Returns `null` when the base is 0 so the card renders "—" rather than a
 * misleading NaN or "0 %" (small-account signal, not real churn).
 *
 * `expired` is DELIBERATELY EXCLUDED : an expired trial that never converted
 * is not a paying customer who left — trial-to-paid conversion is already
 * covered by the Trial → Paid KPI. Counting expired here would double-book
 * the same signal and inflate churn artificially early in the funnel.
 */
export function subscriptionChurnRate30d(
  rows:  Array<{ subscription_status: string | null; canceled_at: string | null }>,
  nowMs: number,
): number | null {
  const WINDOW_MS = 30 * 86_400_000
  let churned      = 0
  let activePaying = 0
  for (const r of rows) {
    if (r.subscription_status === 'active') {
      activePaying++
      continue
    }
    if (r.subscription_status !== 'canceled' || !r.canceled_at) continue
    const canceledMs = Date.parse(r.canceled_at)
    if (Number.isNaN(canceledMs)) continue
    if (nowMs - canceledMs < WINDOW_MS) churned++
  }
  const base = activePaying + churned
  if (base === 0) return null
  return (churned / base) * 100
}

/**
 * Human-readable status label + tone for a single workspace. Used by
 * per-row admin badges (users list, workspace detail). The plan tier is
 * displayed alongside — this helper covers status only.
 */
export function billingLabel(ws: BillingRow): { label: string; tone: 'green' | 'amber' | 'red' | 'gray' } {
  switch (ws.subscription_status) {
    case 'active':   return { label: 'Active',   tone: 'green' }
    case 'trialing': return { label: 'Trial',    tone: 'amber' }
    case 'past_due': return { label: 'Past due', tone: 'red'   }
    case 'canceled': return { label: 'Canceled', tone: 'gray'  }
    case 'expired':  return { label: 'Expired',  tone: 'gray'  }
    default:         return { label: '—',        tone: 'gray'  }
  }
}
