'use client'

/**
 * Admin editor for the plans-config table.
 *
 * Two-block card per tier :
 *   - CAPS block : 6 integer inputs (edit + Save). PUT /api/admin/plans.
 *   - PRICE block : monthly + annual_discount READ-ONLY (Stripe is the
 *     billing truth) ; live Stripe amounts + drift pill ; "Sync from
 *     Stripe" button → POST /api/admin/plans { action:'sync_stripe_price' }.
 *
 * Design tokens follow the admin surface (limits/revenue/email-sequences) :
 *   - page bg #f5f2ee via layout ; card bg #fff, border #e8e3dc, rounded-lg
 *   - primary #3b6bef (Save / Sync buttons + focus rings)
 *   - captions #6b5e4e / #8a7e6e
 *   - status pill badges via <StatusBadge> — never colour-only text.
 *
 * States gracefully degrade : Stripe not configured → "Not configured"
 * badges on every tier (no crash, caps still editable).
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/StatusBadge'

type Tier = 'free' | 'starter' | 'pro' | 'power'

interface Caps {
  total_prospects:             number
  prospects_sourced_per_month: number
  enrichments_per_month:       number
  emails_per_month:            number
  scans_per_month:             number
  inboxes:                     number
}

interface StripeInfo {
  configured:       boolean
  monthly_id:       string | null
  monthly_amount:   number | null
  yearly_id:        string | null
  yearly_amount:    number | null
  derived_discount: number | null
}

interface TierEntry {
  tier:              Tier
  monthly_price_usd: number | null
  annual_discount:   number | null
  stripe_price_id:   string | null
  caps:              Caps
  stripe:            StripeInfo
  drift:             boolean
}

const TIERS_ORDER: Tier[] = ['free', 'starter', 'pro', 'power']

const TIER_LABEL: Record<Tier, string> = {
  free:    'Free',
  starter: 'Starter',
  pro:     'Pro',
  power:   'Power',
}

const CAP_FIELDS: Array<{ key: keyof Caps; label: string; help?: string }> = [
  { key: 'total_prospects',             label: 'Total prospects (lifetime)',    help: 'Hard lifetime cap on contacts.' },
  { key: 'prospects_sourced_per_month', label: 'Prospects sourced / month',     help: 'AI sourcing monthly cap (no overage).' },
  { key: 'enrichments_per_month',       label: 'Enrichments / month',           help: 'Monthly enrichment credits.' },
  { key: 'emails_per_month',            label: 'Emails sent / month',           help: 'Monthly email send cap.' },
  { key: 'scans_per_month',             label: 'Signal scans / month',          help: 'Monthly signal-scan cap.' },
  { key: 'inboxes',                     label: 'Inboxes',                       help: 'Max connected sending mailboxes.' },
]

function fmtUsd(v: number | null): string {
  if (v == null) return '—'
  return `$${v.toFixed(2)}`
}

function fmtDiscount(v: number | null): string {
  if (v == null) return '—'
  return `${(v * 100).toFixed(1)}%`
}

function priceBadge(entry: TierEntry): { variant: 'green' | 'amber' | 'gray'; label: string } {
  if (entry.tier === 'free') return { variant: 'gray', label: 'No price' }
  if (!entry.stripe.configured) return { variant: 'gray', label: 'Not configured' }
  if (entry.drift) return { variant: 'amber', label: 'Drift' }
  return { variant: 'green', label: 'In sync' }
}

export function PlansClient() {
  const [entries, setEntries] = useState<TierEntry[]>([])
  const [drafts, setDrafts]   = useState<Record<Tier, Caps>>({} as Record<Tier, Caps>)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingTier, setSavingTier] = useState<Tier | null>(null)
  const [syncingTier, setSyncingTier] = useState<Tier | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/admin/plans', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as { tiers: TierEntry[] }
      setEntries(json.tiers)
      const map: Partial<Record<Tier, Caps>> = {}
      for (const t of json.tiers) map[t.tier] = { ...t.caps }
      setDrafts(map as Record<Tier, Caps>)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'unknown')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  function setCap(tier: Tier, key: keyof Caps, raw: string) {
    const n = Number(raw)
    setDrafts((prev) => ({
      ...prev,
      [tier]: {
        ...prev[tier],
        [key]: Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0,
      },
    }))
  }

  async function saveCaps(tier: Tier) {
    const caps = drafts[tier]
    if (!caps) return
    setSavingTier(tier)
    try {
      const res = await fetch('/api/admin/plans', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tier, ...caps }),
      })
      const json = await res.json().catch(() => ({} as { error?: string; message?: string }))
      if (!res.ok) {
        throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`)
      }
      toast.success(`${TIER_LABEL[tier]} caps saved`)
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingTier(null)
    }
  }

  async function syncPrice(tier: Tier) {
    setSyncingTier(tier)
    try {
      const res = await fetch('/api/admin/plans', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'sync_stripe_price', tier }),
      })
      const json = await res.json().catch(() => ({} as { error?: string; message?: string }))
      if (!res.ok) {
        throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`)
      }
      toast.success(`${TIER_LABEL[tier]} price synced from Stripe`)
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncingTier(null)
    }
  }

  return (
    <div className="mx-auto max-w-7xl p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Plans</h1>
        <p className="mt-1 text-sm text-[#4a4a5a]">
          Edit tier caps freely. Prices are sourced from Stripe — use{' '}
          <span className="font-medium text-[#1a1a1a]">Sync from Stripe</span>{' '}
          to update the table after a Stripe price change.
        </p>
      </div>

      {loading && (
        <div className="rounded-lg border border-[#e8e3dc] bg-white p-6 text-sm text-[#6b5e4e]">
          Loading plans…
        </div>
      )}

      {loadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-900">
          <p className="font-medium">Failed to load plans.</p>
          <p className="mt-1">{loadError}</p>
        </div>
      )}

      {!loading && !loadError && (
        <div className="flex flex-col gap-4">
          {TIERS_ORDER.map((tier) => {
            const entry = entries.find((e) => e.tier === tier)
            const draft = drafts[tier]
            if (!entry || !draft) return null

            const badge = priceBadge(entry)
            const dirty = CAP_FIELDS.some((f) => draft[f.key] !== entry.caps[f.key])

            return (
              <section
                key={tier}
                className="rounded-lg border border-[#e8e3dc] bg-white p-5"
                aria-label={`Plan ${TIER_LABEL[tier]}`}
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-[#1a1a1a]">{TIER_LABEL[tier]}</h2>
                    <p className="mt-0.5 text-xs text-[#9a9a9a]">
                      Tier <span className="font-mono">{tier}</span>
                    </p>
                  </div>
                  <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
                </div>

                {/* ── PRICE block (read-only, Stripe = truth) ────────────── */}
                <div className="mb-5 rounded-md border border-[#e8e3dc] bg-[#faf8f5] p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-[#4a4a5a]">Price</h3>
                    {tier !== 'free' && (
                      <button
                        type="button"
                        onClick={() => syncPrice(tier)}
                        disabled={syncingTier !== null || !entry.stripe.configured}
                        className="rounded-md border border-[#e8e3dc] bg-white px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5f2ee] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef]"
                      >
                        {syncingTier === tier ? 'Syncing…' : 'Sync from Stripe'}
                      </button>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-[11px] font-medium uppercase tracking-wide text-[#9a9a9a]">Monthly (table)</div>
                      <div className="mt-0.5 text-sm font-mono text-[#1a1a1a]">{fmtUsd(entry.monthly_price_usd)}</div>
                      <div className="mt-1 text-[11px] text-[#9a9a9a]">
                        Stripe live : <span className="font-mono text-[#4a4a5a]">{fmtUsd(entry.stripe.monthly_amount)}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-medium uppercase tracking-wide text-[#9a9a9a]">Annual discount (table)</div>
                      <div className="mt-0.5 text-sm font-mono text-[#1a1a1a]">{fmtDiscount(entry.annual_discount)}</div>
                      <div className="mt-1 text-[11px] text-[#9a9a9a]">
                        Stripe live : <span className="font-mono text-[#4a4a5a]">{fmtDiscount(entry.stripe.derived_discount)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 text-[11px] text-[#9a9a9a]">
                    Stripe price ID :{' '}
                    <span
                      className="font-mono text-[#4a4a5a]"
                      title={entry.stripe_price_id ?? ''}
                    >
                      {entry.stripe_price_id
                        ? entry.stripe_price_id.length > 24
                          ? entry.stripe_price_id.slice(0, 24) + '…'
                          : entry.stripe_price_id
                        : '—'}
                    </span>
                  </div>
                </div>

                {/* ── CAPS block (editable) ───────────────────────────────── */}
                <div>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-[#4a4a5a]">Caps</h3>
                    <button
                      type="button"
                      onClick={() => saveCaps(tier)}
                      disabled={!dirty || savingTier !== null}
                      className="rounded-md bg-[#3b6bef] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#2d5cd8] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2"
                    >
                      {savingTier === tier ? 'Saving…' : 'Save caps'}
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {CAP_FIELDS.map((f) => {
                      const inputId = `cap-${tier}-${f.key}`
                      const changed = draft[f.key] !== entry.caps[f.key]
                      return (
                        <label
                          key={f.key}
                          htmlFor={inputId}
                          className="block"
                        >
                          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[#4a4a5a]">
                            {f.label}
                          </div>
                          <input
                            id={inputId}
                            type="number"
                            min={0}
                            step={1}
                            value={draft[f.key]}
                            onChange={(e) => setCap(tier, f.key, e.target.value)}
                            className={`w-full rounded-md border px-3 py-1.5 text-sm text-[#1a1a1a] transition-colors focus:outline-none focus:ring-2 focus:ring-[#3b6bef] ${changed ? 'border-[#3b6bef] bg-[#f7f8ff]' : 'border-[#e8e3dc] bg-white'}`}
                          />
                          {f.help && (
                            <div className="mt-1 text-[11px] text-[#9a9a9a]">{f.help}</div>
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
