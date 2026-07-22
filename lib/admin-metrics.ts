/**
 * lib/admin-metrics.ts — single source of truth for admin billing metrics.
 *
 * BEFORE this file existed, "paid / active / MRR" was recomputed at least
 * six different ways across the admin surface, each with a different
 * predicate :
 *
 *   - /admin/overview           → `plan_tier != 'trial'`  + a local MRR_BY_TIER map
 *   - /admin/analytics          → `plan_tier != 'trial'`  (paid + funnel)
 *   - /api/admin/users          → no billing status at all
 *   - /admin/users PlanPill     → `plan_tier != 'trial'`  ("blue pill = paid")
 *   - /api/admin/stats          → `workspaces.plan` (legacy column) as MRR proxy
 *   - /api/admin/broadcast      → `workspaces.plan` (legacy column) for target
 *
 * Only /admin/revenue used `subscription_status === 'active'` correctly, so the
 * Overview showed 1 paid / 399$ MRR while Revenue showed 2 paid / 698$ MRR on
 * the same DB. This helper mirrors /admin/revenue's semantics verbatim :
 *
 *   - "paid"   ≡ `subscription_status === 'active'`
 *   - MRR      = sum of `monthlyMrrForWorkspace(plan_tier, billing_interval)`
 *                over ACTIVE rows only (excludes past_due, trialing, etc.)
 *   - Prices   from lib/pricing.ts → PLAN_PRICES (nothing redefined here).
 *
 * Callers that need to display a per-row badge should use `billingLabel()`.
 * The plan tier is intentionally rendered separately (see PlanPill in
 * app/admin/users/_components/UsersListClient.tsx) — a canceled/expired
 * workspace still has a plan_tier value in the DB but should NOT be shown
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
  'id, plan_tier, subscription_status, billing_interval, trial_end_date' as const

export interface BillingRow {
  plan_tier:           string | null
  subscription_status: string | null
  // Optional because two admin call-sites (broadcast + stats) only need the
  // status predicate `isActivePaid` and never compute MRR. Full aggregation
  // via `aggregateBilling` / `workspaceMrr` still expects the column to be
  // selected — a missing value there is treated as null (== assume monthly).
  billing_interval?:   string | null
  trial_end_date?:     string | null
}

/**
 * Truth predicate for "this workspace is a paying customer right now".
 * Deliberately excludes past_due : the workspace still owes money and the
 * MRR is unrecoverable until they settle up, matching Stripe's convention.
 */
export function isActivePaid(ws: BillingRow): boolean {
  return ws.subscription_status === 'active'
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
  active:                   number
  trialing:                 number
  pastDue:                  number
  canceled:                 number
  expired:                  number
  /** Alias of `active` — kept as a distinct field so call-sites read as "paidCount", not "active". */
  paidCount:                number
  mrrTotal:                 number
  /** Active rows whose plan_tier is not in PLAN_PRICES (excluded from mrrTotal). */
  unknownPlanActiveCount:   number
  /** Active rows whose billing_interval was null/unknown → treated as monthly. */
  intervalAssumedCount:     number
}

/**
 * Full aggregate over an array of workspace rows. Mirrors /admin/revenue's
 * loop exactly, including the "MRR excludes past_due" rule.
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

    if (ws.subscription_status !== 'active') continue

    const m = workspaceMrr(ws)
    if (!m) {
      agg.unknownPlanActiveCount++
      continue
    }
    agg.mrrTotal += m.mrr_usd
    if (m.interval_assumed_monthly) agg.intervalAssumedCount++
  }

  agg.paidCount = agg.active
  return agg
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
