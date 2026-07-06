'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import CreditUsageIndicator from '@/components/CreditUsageIndicator'
import { track } from '@/lib/track'

// ─── Types ────────────────────────────────────────────────────────────────────
interface UsageData {
  plan_tier: string
  total_prospects_count: number; total_prospects_cap: number
  // legacy compat aliases (kept for billing page backward compat)
  prospects_added: number; prospects_cap: number
  enrichments_used: number; enrichments_cap: number
  emails_sent: number; emails_cap: number
  prospects_sourced_used: number; prospects_sourced_cap: number
  reset_date: string
  inboxes_used: number; inboxes_cap: number; overage_enabled: boolean
  overage_charges_made: number
  trial_end: string | null; subscription_status: string
  days_remaining: number; blocked: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Brand names — kept as-is, never translated.
const PLAN_LABELS: Record<string, string> = { starter: 'Starter', pro: 'Pro', power: 'Power' }

// Subscription status keys — resolved at render via useTranslations('...statuses').
// Sujet grammatical FR = abonnement (masc.), LOCAL, no cross-namespace reuse.
const SUBSCRIPTION_STATUS_KEYS = ['trialing', 'active', 'past_due', 'canceled', 'expired'] as const

// PLANS keeps numeric values + name + inherits. Feature bullets resolved at render
// via t('plans.features.{planId}.{index}'). Values remain hardcoded ($/mo, $/yr) —
// currency + number formats deferred to a dedicated locale-format lot.
const PLANS = [
  { id: 'starter', name: 'Starter', monthly: 149, yearly: 1430, prospects: 100, enrichments: 500,  inboxes: 1, inherits: null,      featureCount: 5 },
  { id: 'pro',     name: 'Pro',     monthly: 299, yearly: 2870, prospects: 250, enrichments: 1000, inboxes: 2, inherits: 'Starter', featureCount: 6 },
  { id: 'power',   name: 'Power',   monthly: 399, yearly: 3830, prospects: 500, enrichments: 2000, inboxes: 3, inherits: 'Pro',     featureCount: 5 },
]

// ─── Main page ────────────────────────────────────────────────────────────────
export default function BillingPage() {
  const t = useTranslations('dashboard.billing')
  const tHeader = useTranslations('dashboard.billing.header')
  const tBanners = useTranslations('dashboard.billing.banners')
  const tLabels = useTranslations('dashboard.billing.sectionLabels')
  const tCurrent = useTranslations('dashboard.billing.currentPlan')
  const tStatuses = useTranslations('dashboard.billing.statuses')
  const tPlans = useTranslations('dashboard.billing.plans')
  const tButton = useTranslations('dashboard.billing.plans.button')
  const tFeatures = useTranslations('dashboard.billing.plans.features')
  const tOverage = useTranslations('dashboard.billing.overage')
  const tPromo = useTranslations('dashboard.billing.promo')
  const tToasts = useTranslations('dashboard.billing.toasts')

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
    fetch('/api/usage/current').then(r => r.json()).then((data) => {
      setUsage(data)
      if (checkoutResult === 'success' && data?.plan_tier) {
        track('subscription_created', { plan: data.plan_tier })
      }
    })
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(t)
  }, [toast])

  async function startCheckout(plan: string) {
    setLoadingCheckout(plan)
    const body: Record<string, string> = { plan, interval }
    if (promoCode.trim()) body.promo_code = promoCode.trim()
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json())
    if (res.url) window.location.href = res.url
    else { setToast(res.error ?? tToasts('checkoutFailed')); setLoadingCheckout(null) }
  }

  async function changePlan(plan: string) {
    setLoadingCheckout(plan)
    const res = await fetch('/api/stripe/change-plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, interval }),
    }).then(r => r.json())
    setLoadingCheckout(null)
    if (res.noop) { setToast(res.message ?? tToasts('alreadyOnPlan')); return }
    if (res.success) {
      setToast(tToasts('planChanged'))
      setTimeout(() => window.location.reload(), 3000)
      return
    }
    setToast(res.error ?? tToasts('changePlanFailed'))
  }

  async function openPortal() {
    setLoadingPortal(true)
    const res = await fetch('/api/stripe/portal', { method: 'POST' }).then(r => r.json())
    if (res.url) window.location.href = res.url
    else { setToast(res.error ?? tToasts('portalError')); setLoadingPortal(false) }
  }

  async function applyPromo() {
    if (!promoCode.trim()) return
    setLoadingPromo(true); setPromoMsg(null)
    const res = await fetch('/api/stripe/promo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promo_code: promoCode.trim() }),
    }).then(r => r.json())
    setPromoMsg({ ok: !!res.success, text: res.message ?? res.error ?? tPromo('unknownError') })
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

  const currentPlan = usage?.plan_tier
  const status      = usage?.subscription_status
  const isActive    = status === 'active'
  const canUsePortal = ['active', 'past_due', 'canceled'].includes(status ?? '')
  const tierIndex: Record<string, number> = { starter: 0, pro: 1, power: 2 }

  const statusLabel = status && (SUBSCRIPTION_STATUS_KEYS as readonly string[]).includes(status)
    ? tStatuses(status)
    : status

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
          {tBanners('checkoutSuccess')}
        </div>
      )}
      {checkoutResult === 'cancel' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-sm text-amber-700">
          {tBanners('checkoutCancel')}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1a1a2e]">{tHeader('title')}</h1>
        <p className="text-sm text-[#8a7e6e]">{tHeader('subtitle')}</p>
      </div>

      {/* ── Section 1: Current plan ────────────────────────────────────────── */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">{tLabels('currentPlan')}</div>
        {!usage ? (
          <p className="text-sm text-[#8a7e6e]">{t('loading')}</p>
        ) : (
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg font-bold text-[#1a1a2e]">{PLAN_LABELS[currentPlan ?? ''] ?? currentPlan}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                  status === 'active'   ? 'bg-green-50 text-green-700' :
                  status === 'trialing' ? 'bg-blue-50 text-[#3b6bef]' :
                  status === 'past_due' ? 'bg-amber-50 text-amber-700' :
                  'bg-red-50 text-red-600'
                }`}>
                  {statusLabel}
                </span>
              </div>
              {status === 'trialing' && usage.days_remaining > 0 && (
                <p className="text-sm text-[#6b5e4e]">
                  {tCurrent('trialDaysLeft', { count: usage.days_remaining })}
                </p>
              )}
              {status === 'trialing' && usage.days_remaining <= 3 && usage.days_remaining > 0 && (
                <p className="text-xs text-amber-600 font-medium mt-1">
                  {tCurrent('trialEndsSoon')}
                </p>
              )}
              {usage.blocked && (
                <p className="text-xs text-red-600 font-medium mt-1">
                  {tCurrent('accessBlocked')}
                </p>
              )}
            </div>
            {canUsePortal ? (
              <button onClick={openPortal} disabled={loadingPortal}
                className="bg-white border border-[#e8e3dc] text-[#1a1a2e] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#f5f2ee] disabled:opacity-40">
                {loadingPortal ? tCurrent('openingPortal') : tCurrent('managePortal')}
              </button>
            ) : (
              <button onClick={() => startCheckout(currentPlan!)} disabled={!!loadingCheckout}
                className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40">
                {loadingCheckout ? t('redirecting') : tCurrent('addPaymentMethod')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Section 2: Usage ──────────────────────────────────────────────── */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">{tLabels('usage')}</div>
        {!usage ? (
          <p className="text-sm text-[#8a7e6e]">{t('loading')}</p>
        ) : (
          <div className="flex flex-col gap-5">
            <CreditUsageIndicator
              metric="total_prospects"
              current={usage.total_prospects_count}
              cap={usage.total_prospects_cap}
            />
            <CreditUsageIndicator
              metric="emails_per_month"
              current={usage.emails_sent}
              cap={usage.emails_cap}
              resetDate={usage.reset_date}
            />
            <CreditUsageIndicator
              metric="prospects_sourced_per_month"
              current={usage.prospects_sourced_used}
              cap={usage.prospects_sourced_cap}
              resetDate={usage.reset_date}
            />
          </div>
        )}
      </div>

      {/* ── Section 3: Plans ──────────────────────────────────────────────── */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider">{tLabels('plans')}</div>
          <div className="flex items-center gap-1 p-1 bg-[#f0ece6] rounded-xl text-xs">
            <button onClick={() => setInterval('monthly')}
              className={"px-3 py-1 rounded-lg font-medium transition-colors " + (interval === 'monthly' ? 'bg-white text-[#1a1a2e] shadow-sm' : 'text-[#8a7e6e]')}>
              {tPlans('intervalMonthly')}
            </button>
            <button onClick={() => setInterval('yearly')}
              className={"px-3 py-1 rounded-lg font-medium transition-colors " + (interval === 'yearly' ? 'bg-white text-[#1a1a2e] shadow-sm' : 'text-[#8a7e6e]')}>
              {tPlans('intervalYearly')} <span className="text-green-600">{tPlans('yearlyDiscount')}</span>
            </button>
          </div>
        </div>
        {!usage ? (
          <p className="text-sm text-[#8a7e6e]">{t('loading')}</p>
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PLANS.map(p => {
            const isCurrent  = p.id === currentPlan
            // $ hardcodé + /yr /mo suffixes — traité au lot formats localisés futur
            const price      = interval === 'yearly' ? `$${p.yearly}/yr` : `$${p.monthly}/mo`
            const tIdx       = tierIndex[p.id] ?? 0
            const cIdx       = tierIndex[currentPlan ?? ''] ?? 0
            const isCurrentActive = isCurrent && isActive
            let btnLabel: string
            if (status === 'trialing' || status === 'expired') {
              btnLabel = tButton('addPaymentMethod')
            } else if (status === 'canceled') {
              btnLabel = tButton('reactivate', { planName: p.name })
            } else if (tIdx > cIdx) {
              btnLabel = tButton('upgradeTo', { planName: p.name })
            } else if (tIdx < cIdx) {
              btnLabel = tButton('downgradeTo', { planName: p.name })
            } else {
              btnLabel = tButton('currentPlan')
            }
            const planId = p.id as 'starter' | 'pro' | 'power'
            return (
              <div key={p.id} className={`rounded-xl border p-4 ${isCurrent ? 'border-[#3b6bef] bg-[#eef1fd]' : 'border-[#e8e3dc] bg-white'}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="font-bold text-[#1a1a2e] text-sm">{p.name}</div>
                  {isCurrent && <span className="text-xs bg-[#3b6bef] text-white px-2 py-0.5 rounded-full">{tPlans('currentBadge')}</span>}
                </div>
                <div className="text-xl font-bold text-[#1a1a2e] mb-3">{price}</div>
                <ul className="flex flex-col gap-1.5 mb-4 text-xs text-[#4a4a5a]">
                  {p.inherits && (
                    <li className="text-[10px] font-semibold text-[#8a7e6e] mb-0.5">{tPlans('inheritsFrom', { previousPlan: p.inherits })}</li>
                  )}
                  {Array.from({ length: p.featureCount }, (_, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <span className="text-green-500">✓</span>
                      {tFeatures(`${planId}.${i}`)}
                    </li>
                  ))}
                </ul>
                {isCurrentActive ? (
                  <button disabled className="w-full border border-[#3b6bef] text-[#3b6bef] rounded-lg py-2 text-xs font-semibold opacity-50">
                    {tButton('currentPlan')}
                  </button>
                ) : (
                  <button
                    onClick={() => isActive ? changePlan(p.id) : startCheckout(p.id)}
                    disabled={!!loadingCheckout}
                    className="w-full bg-[#3b6bef] hover:bg-[#2a5bdf] text-white rounded-lg py-2 text-xs font-semibold disabled:opacity-40 transition-colors">
                    {loadingCheckout === p.id ? (isActive ? tButton('changing') : t('redirecting')) : btnLabel}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        )}
      </div>

      {/* ── Section 4: Overage ────────────────────────────────────────────── */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">{tLabels('overage')}</div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[#1a1a2e] mb-1">{tOverage('title')}</p>
            <p className="text-xs text-[#8a7e6e]">
              {tOverage('description')}
            </p>
            {usage?.overage_enabled && (
              <p className="text-xs text-amber-600 font-medium mt-1">
                {tOverage('activeWarning')}
              </p>
            )}
            {usage && usage.enrichments_used > usage.enrichments_cap && (
              <p className="text-xs text-[#6b5e4e] mt-1">
                {tOverage('overCap', { count: usage.enrichments_used - usage.enrichments_cap })}
                {usage.overage_charges_made > 0 && tOverage('autoCharged', { amount: `$${usage.overage_charges_made * 10}` })}
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
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">{tLabels('promoCode')}</div>
        <div className="flex gap-2">
          <input value={promoCode} onChange={e => setPromoCode(e.target.value.toUpperCase())}
            placeholder={tPromo('placeholder')}
            className="flex-1 border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] uppercase" />
          <button onClick={applyPromo} disabled={loadingPromo || !promoCode.trim()}
            className="bg-[#1a1a2e] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
            {loadingPromo ? tPromo('applying') : tPromo('apply')}
          </button>
        </div>
        {promoMsg && (
          <p className={`text-xs mt-2 font-medium ${promoMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
            {promoMsg.ok ? '✓ ' : '✕ '}{promoMsg.text}
          </p>
        )}
        <p className="text-xs text-[#b0a898] mt-2">{tPromo('footerNote')}</p>
      </div>
    </div>
  )
}
