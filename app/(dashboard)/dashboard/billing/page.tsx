'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────
interface UsageData {
  plan_tier: string; prospects_added: number; prospects_cap: number
  enrichments_used: number; enrichments_cap: number; emails_sent: number
  inboxes_used: number; inboxes_cap: number; overage_enabled: boolean
  trial_end: string | null; subscription_status: string
  days_remaining: number; blocked: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const PLAN_LABELS: Record<string, string> = { starter: 'Starter', pro: 'Pro', power: 'Power' }
const STATUS_LABELS: Record<string, string> = {
  trialing: 'Free Trial', active: 'Active', past_due: 'Payment due',
  canceled: 'Canceled', expired: 'Expired',
}

function UsageBar({ label, used, cap }: { label: string; used: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-green-500'
  return (
    <div>
      <div className="flex justify-between text-xs text-[#6b5e4e] mb-1">
        <span className="font-medium">{label}</span>
        <span>{used} / {cap} <span className="text-[#b0a898]">({pct}%)</span></span>
      </div>
      <div className="w-full bg-[#f0ece6] rounded-full h-2">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {pct >= 100 && (
        <p className="text-xs text-red-600 mt-1 font-medium">Cap reached. Upgrade or enable overage.</p>
      )}
    </div>
  )
}

const PLANS = [
  { id: 'starter', name: 'Starter', monthly: 149, yearly: 1430, prospects: 100, enrichments: 500, inboxes: 1, features: ['100 prospects/mo','500 enrichments/mo','1 inbox','Booking page','Morning Brief'] },
  { id: 'pro',     name: 'Pro',     monthly: 299, yearly: 2870, prospects: 250, enrichments: 1000, inboxes: 2, features: ['250 prospects/mo','1,000 enrichments/mo','2 inboxes','Advanced AI','Morning Brief Mode B','Priority support'] },
  { id: 'power',   name: 'Power',   monthly: 399, yearly: 3830, prospects: 500, enrichments: 2000, inboxes: 3, features: ['500 prospects/mo','2,000 enrichments/mo','3 inboxes','Premium AI + caching','All features'] },
]

// ─── Main page ────────────────────────────────────────────────────────────────
export default function BillingPage() {
  const searchParams = useSearchParams()
  const checkoutResult = searchParams.get('checkout')

  const [usage, setUsage]         = useState<UsageData | null>(null)
  const [interval, setInterval]   = useState<'monthly' | 'yearly'>('monthly')
  const [promoCode, setPromoCode] = useState('')
  const [promoMsg, setPromoMsg]   = useState<{ ok: boolean; text: string } | null>(null)
  const [loadingCheckout, setLoadingCheckout] = useState<string | null>(null)
  const [loadingPortal, setLoadingPortal]     = useState(false)
  const [loadingPromo, setLoadingPromo]       = useState(false)
  const [overageLoading, setOverageLoading]   = useState(false)
  const [toast, setToast]                     = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/usage/current').then(r => r.json()).then(setUsage)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  async function startCheckout(plan: string) {
    setLoadingCheckout(plan)
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, interval }),
    }).then(r => r.json())
    if (res.url) window.location.href = res.url
    else { setToast(res.error ?? 'Checkout failed'); setLoadingCheckout(null) }
  }

  async function openPortal() {
    setLoadingPortal(true)
    const res = await fetch('/api/stripe/portal', { method: 'POST' }).then(r => r.json())
    if (res.url) window.location.href = res.url
    else { setToast(res.error ?? 'Portal error'); setLoadingPortal(false) }
  }

  async function applyPromo() {
    if (!promoCode.trim()) return
    setLoadingPromo(true); setPromoMsg(null)
    const res = await fetch('/api/stripe/promo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promo_code: promoCode.trim() }),
    }).then(r => r.json())
    setPromoMsg({ ok: !!res.success, text: res.message ?? res.error ?? 'Unknown error' })
    setLoadingPromo(false)
  }

  async function toggleOverage() {
    if (!usage) return
    setOverageLoading(true)
    const next = !usage.overage_enabled
    const res = await fetch('/api/billing/overage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overage_enabled: next }),
    }).then(r => r.json())
    if (!res.error) setUsage({ ...usage, overage_enabled: next })
    else setToast(res.error)
    setOverageLoading(false)
  }

  const currentPlan = usage?.plan_tier ?? 'starter'
  const status      = usage?.subscription_status ?? 'trialing'
  const isActive    = status === 'active'

  return (
    <div className="max-w-2xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-white border border-[#e8e3dc] rounded-xl shadow-lg px-4 py-3 text-sm text-[#1a1a2e] max-w-sm">
          {toast}
        </div>
      )}

      {/* Checkout result banner */}
      {checkoutResult === 'success' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-5 text-sm text-green-700 font-medium">
          ✓ Subscription activated! Welcome to Sentra.
        </div>
      )}
      {checkoutResult === 'cancel' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-sm text-amber-700">
          Checkout cancelled. Your trial is still active.
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1a1a2e]">Billing</h1>
        <p className="text-sm text-[#8a7e6e]">Manage your plan, usage, and payment</p>
      </div>

      {/* ── Section 1: Current plan ────────────────────────────────────────── */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">CURRENT PLAN</div>
        {!usage ? (
          <p className="text-sm text-[#8a7e6e]">Loading...</p>
        ) : (
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg font-bold text-[#1a1a2e]">{PLAN_LABELS[currentPlan] ?? currentPlan}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                  status === 'active'   ? 'bg-green-50 text-green-700' :
                  status === 'trialing' ? 'bg-blue-50 text-[#3b6bef]' :
                  status === 'past_due' ? 'bg-amber-50 text-amber-700' :
                  'bg-red-50 text-red-600'
                }`}>
                  {STATUS_LABELS[status] ?? status}
                </span>
              </div>
              {status === 'trialing' && usage.days_remaining > 0 && (
                <p className="text-sm text-[#6b5e4e]">
                  {usage.days_remaining} day{usage.days_remaining !== 1 ? 's' : ''} left in trial
                </p>
              )}
              {status === 'trialing' && usage.days_remaining <= 3 && usage.days_remaining > 0 && (
                <p className="text-xs text-amber-600 font-medium mt-1">
                  ⚠ Trial ends soon — add a payment method to continue.
                </p>
              )}
              {usage.blocked && (
                <p className="text-xs text-red-600 font-medium mt-1">
                  Your access is restricted. Upgrade to restore full access.
                </p>
              )}
            </div>
            {isActive ? (
              <button onClick={openPortal} disabled={loadingPortal}
                className="bg-white border border-[#e8e3dc] text-[#1a1a2e] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#f5f2ee] disabled:opacity-40">
                {loadingPortal ? 'Opening...' : 'Manage subscription →'}
              </button>
            ) : (
              <button onClick={() => startCheckout(currentPlan)} disabled={!!loadingCheckout}
                className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40">
                {loadingCheckout ? 'Redirecting...' : 'Add payment method →'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Section 2: Usage ──────────────────────────────────────────────── */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">USAGE THIS MONTH</div>
        {!usage ? (
          <p className="text-sm text-[#8a7e6e]">Loading...</p>
        ) : (
          <div className="flex flex-col gap-4">
            <UsageBar label="Prospects added"  used={usage.prospects_added}  cap={usage.prospects_cap} />
            <UsageBar label="Enrichments used" used={usage.enrichments_used} cap={usage.enrichments_cap} />
            <UsageBar label="Inboxes"          used={usage.inboxes_used}     cap={usage.inboxes_cap} />
          </div>
        )}
      </div>

      {/* ── Section 3: Plans ──────────────────────────────────────────────── */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider">PLANS</div>
          <div className="flex items-center gap-1 p-1 bg-[#f0ece6] rounded-xl text-xs">
            <button onClick={() => setInterval('monthly')}
              className={"px-3 py-1 rounded-lg font-medium transition-colors " + (interval === 'monthly' ? 'bg-white text-[#1a1a2e] shadow-sm' : 'text-[#8a7e6e]')}>
              Monthly
            </button>
            <button onClick={() => setInterval('yearly')}
              className={"px-3 py-1 rounded-lg font-medium transition-colors " + (interval === 'yearly' ? 'bg-white text-[#1a1a2e] shadow-sm' : 'text-[#8a7e6e]')}>
              Yearly <span className="text-green-600">−20%</span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PLANS.map(p => {
            const isCurrent = p.id === currentPlan
            const price = interval === 'yearly'
              ? `$${p.yearly}/yr`
              : `$${p.monthly}/mo`
            return (
              <div key={p.id} className={`rounded-xl border p-4 ${isCurrent ? 'border-[#3b6bef] bg-[#eef1fd]' : 'border-[#e8e3dc] bg-white'}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="font-bold text-[#1a1a2e] text-sm">{p.name}</div>
                  {isCurrent && <span className="text-xs bg-[#3b6bef] text-white px-2 py-0.5 rounded-full">Current</span>}
                </div>
                <div className="text-xl font-bold text-[#1a1a2e] mb-3">{price}</div>
                <ul className="flex flex-col gap-1.5 mb-4 text-xs text-[#4a4a5a]">
                  {p.features.map(f => (
                    <li key={f} className="flex items-center gap-1.5"><span className="text-green-500">✓</span>{f}</li>
                  ))}
                </ul>
                {isCurrent && isActive ? (
                  <button disabled className="w-full border border-[#3b6bef] text-[#3b6bef] rounded-lg py-2 text-xs font-semibold opacity-50">
                    Current plan
                  </button>
                ) : (
                  <button onClick={() => startCheckout(p.id)} disabled={!!loadingCheckout}
                    className="w-full bg-[#3b6bef] hover:bg-[#2a5bdf] text-white rounded-lg py-2 text-xs font-semibold disabled:opacity-40 transition-colors">
                    {loadingCheckout === p.id ? 'Redirecting...' : isCurrent ? 'Reactivate' : 'Upgrade'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Section 4: Overage ────────────────────────────────────────────── */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">OVERAGE</div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[#1a1a2e] mb-1">Enable enrichment overage</p>
            <p className="text-xs text-[#8a7e6e]">
              $0.50 per enrichment above your monthly cap. Billed at end of month.
            </p>
            {usage?.overage_enabled && (
              <p className="text-xs text-amber-600 font-medium mt-1">
                ⚠ Overage is active — additional charges may apply.
              </p>
            )}
          </div>
          <button onClick={toggleOverage} disabled={overageLoading || !usage}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${usage?.overage_enabled ? 'bg-[#3b6bef]' : 'bg-[#e8e3dc]'} disabled:opacity-40`}>
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${usage?.overage_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      {/* ── Section 5: Promo code ─────────────────────────────────────────── */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-6">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">PROMO CODE</div>
        <div className="flex gap-2">
          <input value={promoCode} onChange={e => setPromoCode(e.target.value.toUpperCase())}
            placeholder="e.g. LAUNCH50"
            className="flex-1 border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] uppercase" />
          <button onClick={applyPromo} disabled={loadingPromo || !promoCode.trim()}
            className="bg-[#1a1a2e] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
            {loadingPromo ? 'Applying...' : 'Apply'}
          </button>
        </div>
        {promoMsg && (
          <p className={`text-xs mt-2 font-medium ${promoMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
            {promoMsg.ok ? '✓ ' : '✕ '}{promoMsg.text}
          </p>
        )}
        <p className="text-xs text-[#b0a898] mt-2">Applied to your next renewal invoice.</p>
      </div>
    </div>
  )
}
