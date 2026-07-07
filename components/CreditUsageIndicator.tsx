'use client'

import { useTranslations } from 'next-intl'

// CreditUsageIndicator — reusable cap visualization component
//
// Sprint 16b: only static view (no preview prop) is used.
// Simulation + exceeds-cap views are implemented but activated
// Sprint 9 (Clay integration) when preview prop is passed.

export type CapMetric = 'total_prospects' | 'emails_per_month' | 'prospects_sourced_per_month'

interface Props {
  metric:      CapMetric
  current:     number | null | undefined
  cap:         number | null | undefined
  preview?:    number    // if set → simulation mode
  resetDate?:  string    // ISO date — monthly caps only (not total_prospects)
  onUpgrade?:  () => void
  label?:      string    // custom label, otherwise derived from metric
}

const DEFAULT_LABEL_KEYS: Record<CapMetric, string> = {
  total_prospects:             'labelTotalProspects',
  emails_per_month:            'labelEmailsPerMonth',
  prospects_sourced_per_month: 'labelProspectsSourcedPerMonth',
}

function barColor(pct: number): string {
  if (pct >= 85) return 'bg-red-500'
  if (pct >= 60) return 'bg-yellow-500'
  return 'bg-green-500'
}

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString()
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function UpgradeBtn({ onClick }: { onClick: () => void }) {
  const t = useTranslations('components.creditUsageIndicator')
  return (
    <button onClick={onClick}
      className="text-xs bg-[#3b6bef] text-white px-2.5 py-1 rounded-lg font-medium flex-shrink-0">
      {t('upgrade')}
    </button>
  )
}

export default function CreditUsageIndicator({ metric, current, cap, preview, resetDate, onUpgrade, label }: Props) {
  const t            = useTranslations('components.creditUsageIndicator')
  const displayLabel = label ?? t(DEFAULT_LABEL_KEYS[metric])
  const safeCurrent  = current ?? 0
  const safeCap      = cap ?? 0
  const pctCurrent   = safeCap > 0 ? Math.min(100, Math.round((safeCurrent / safeCap) * 100)) : 0
  const remaining    = Math.max(0, safeCap - safeCurrent)

  // ── Exceeds-cap simulation (Sprint 9) ─────────────────────────────────────
  if (preview !== undefined && safeCurrent + preview > safeCap) {
    const after   = safeCurrent + preview
    const deficit = after - safeCap
    return (
      <div>
        <p className="text-xs font-semibold text-[#6b5e4e] mb-1.5">{displayLabel}</p>
        <div className="w-full bg-[#f0ece6] rounded-full h-2 mb-1.5">
          <div className="bg-red-500 h-2 rounded-full w-full" />
        </div>
        <p className="text-xs text-red-600 font-medium mb-2">100% — would exceed cap by {fmt(deficit)}</p>
        <div className="text-xs text-[#6b5e4e] space-y-0.5 mb-3">
          <div>Currently: {fmt(safeCurrent)} / {fmt(safeCap)} · {fmt(remaining)} remaining</div>
          <div>This action would add: +{fmt(preview)}</div>
        </div>
        {onUpgrade && (
          <div className="flex gap-2">
            <UpgradeBtn onClick={onUpgrade} />
          </div>
        )}
      </div>
    )
  }

  // ── Simulation view (Sprint 9) ────────────────────────────────────────────
  if (preview !== undefined) {
    const after    = safeCurrent + preview
    const pctAfter = safeCap > 0 ? Math.min(100, Math.round((after / safeCap) * 100)) : 0
    const warn     = pctAfter >= 85
    return (
      <div>
        <p className="text-xs font-semibold text-[#6b5e4e] mb-1.5">{displayLabel}</p>
        <div className="w-full bg-[#f0ece6] rounded-full h-2 mb-1.5 relative overflow-hidden">
          <div className={`h-2 rounded-full ${barColor(pctCurrent)}`} style={{ width: `${pctCurrent}%` }} />
          {preview > 0 && (
            <div
              className={`absolute top-0 h-2 opacity-50 ${barColor(pctAfter)}`}
              style={{ left: `${pctCurrent}%`, width: `${pctAfter - pctCurrent}%`, borderRight: '2px dashed rgba(0,0,0,0.3)' }}
            />
          )}
        </div>
        <p className="text-xs text-[#8a7e6e] mb-1">
          {pctAfter}% used after this action {warn && <span className="text-yellow-600">⚠️</span>}
        </p>
        <div className="text-xs text-[#6b5e4e] space-y-0.5">
          <div>Currently: {fmt(safeCurrent)} / {fmt(safeCap)}</div>
          <div>This action: +{fmt(preview)}</div>
          <div className="font-medium">
            After: {fmt(after)} / {fmt(safeCap)} · {fmt(Math.max(0, safeCap - after))} remaining
          </div>
        </div>
      </div>
    )
  }

  // ── Static view (Sprint 16b) ──────────────────────────────────────────────
  // When safeCurrent = 0, show a 2px green sliver so the bar reads as "healthy/empty",
  // not as a broken or unloaded state.
  const barWidth  = pctCurrent === 0 ? '2px' : `${pctCurrent}%`
  const barClass  = barColor(pctCurrent)   // green at 0% — correct

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-semibold text-[#6b5e4e]">{displayLabel}</p>
        <span className="text-xs text-[#8a7e6e]">{fmt(safeCurrent)} / {fmt(safeCap)}</span>
      </div>
      <div className="w-full bg-[#f0ece6] rounded-full h-2 mb-1.5">
        <div className={`h-2 rounded-full transition-all ${barClass}`} style={{ width: barWidth }} />
      </div>
      <div className="flex items-center justify-between text-xs text-[#8a7e6e]">
        <span>{t('usageStatus', { pct: pctCurrent, remaining: fmt(remaining) })}</span>
        {resetDate && <span>{t('resets', { date: fmtDate(resetDate) })}</span>}
      </div>
      {pctCurrent >= 100 && (
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-xs text-red-600 font-medium">{t('capReached')}</p>
          {onUpgrade && <UpgradeBtn onClick={onUpgrade} />}
        </div>
      )}
    </div>
  )
}
