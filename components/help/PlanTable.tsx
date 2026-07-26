/**
 * PlanTable — the plans-pricing help article's 3-tier table, rendered from
 * loadPlansConfig() at build/revalidate time. Async Server Component ; no
 * 'use client' anywhere in the chain (parent page and HelpLayout are both
 * server-rendered).
 *
 * Visual contract : the table must look indistinguishable from the other
 * markdown tables in the article. The parent article is wrapped in
 * `<article className="prose ...">` (see components/help/HelpLayout.tsx),
 * so a bare `<table>/<thead>/<tbody>/<tr>/<th>/<td>` inherits Tailwind
 * Typography's default table styling — the same styling a `|` markdown
 * pipe-table compiles down to.
 *
 * Numbers come exclusively from `loadPlansConfig()` — no hard-coded
 * fallback here. The loader itself already falls back to PLANS_SEED on
 * any DB error (PR1 contract), so this component is safe even before
 * migration 082 is applied.
 */

import { loadPlansConfig } from '@/lib/plans'

const fmt = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('en-US')

export async function PlanTable() {
  const cfg = await loadPlansConfig()
  const s = cfg.starter
  const p = cfg.pro
  const w = cfg.power

  return (
    <table>
      <thead>
        <tr>
          <th></th>
          <th>Starter</th>
          <th>Pro</th>
          <th>Power</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Price</td>
          <td>${fmt(s.monthly_price_usd)}/mo</td>
          <td>${fmt(p.monthly_price_usd)}/mo</td>
          <td>${fmt(w.monthly_price_usd)}/mo</td>
        </tr>
        <tr>
          <td>Lifetime prospects</td>
          <td>{fmt(s.total_prospects)}</td>
          <td>{fmt(p.total_prospects)}</td>
          <td>{fmt(w.total_prospects)}</td>
        </tr>
        <tr>
          <td>Emails per month</td>
          <td>{fmt(s.emails_per_month)}</td>
          <td>{fmt(p.emails_per_month)}</td>
          <td>{fmt(w.emails_per_month)}</td>
        </tr>
        <tr>
          <td>Prospect Credits/mo</td>
          <td>{fmt(s.prospects_sourced_per_month)}</td>
          <td>{fmt(p.prospects_sourced_per_month)}</td>
          <td>{fmt(w.prospects_sourced_per_month)}</td>
        </tr>
      </tbody>
    </table>
  )
}
