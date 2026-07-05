'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Radio } from 'lucide-react'
import { Tooltip } from '@/components/Tooltip'
import { SignalCreateModal } from './_components/SignalCreateModal'
import { RunSignalModal } from './_components/RunSignalModal'
import { SpinnerWithText } from '@/components/ui/Spinner'

type Signal = {
  id: string
  name: string
  description: string | null
  source_type: 'template' | 'custom'
  template_id: string | null
  is_active: boolean
  is_sample: boolean
  total_matches_count: number
  last_run_at: string | null
  created_at: string
  updated_at: string
  monitoring_config: Record<string, unknown>
}

// Relative-time helper takes a translator function so the strings are
// resolved at render time (no top-level t() calls, which would break
// module evaluation).
type RelativeTimeT = (
  key: 'never' | 'justNow' | 'minutesAgo' | 'hoursAgo' | 'daysAgo',
  values?: { count: number },
) => string

function relativeTime(iso: string | null, t: RelativeTimeT): string {
  if (!iso) return t('never')
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return mins <= 1 ? t('justNow') : t('minutesAgo', { count: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('hoursAgo', { count: hrs })
  const days = Math.floor(hrs / 24)
  if (days < 30) return t('daysAgo', { count: days })
  return new Date(iso).toLocaleDateString()
}

// Template labels are resolved at render time via
// t('dashboard.signals.list.templates.<template_id>'). No module-level t().

function SignalCard({
  signal,
  onToggle,
  onDelete,
  onRunClick,
}: {
  signal: Signal
  onToggle: (id: string, is_active: boolean) => void
  onDelete: (id: string) => void
  onRunClick: (id: string, name: string) => void
}) {
  const t = useTranslations('dashboard.signals.list')
  const tTemplates = useTranslations('dashboard.signals.list.templates')
  const [toggling, setToggling] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleToggle() {
    setToggling(true)
    await fetch(`/api/signals/${signal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !signal.is_active }),
    })
    onToggle(signal.id, !signal.is_active)
    setToggling(false)
  }

  return (
    <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 flex flex-col gap-3 hover:border-[#c8d4e8] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Radio size={15} className="text-[#3b6bef] flex-shrink-0 mt-0.5" />
          <h3 className="font-bold text-[#1a1a2e] text-sm leading-snug truncate">{signal.name}</h3>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {signal.is_sample && (
            <span className="text-[9px] bg-[#fff3cd] text-[#7a5c1a] border border-[#e8c96a] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide whitespace-nowrap">
              {t('demoBadge')}
            </span>
          )}
          {signal.is_active ? (
            <span className="bg-green-50 text-green-600 border border-green-200 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap">
              {t('activeBadge')}
            </span>
          ) : (
            <span className="bg-gray-50 text-gray-600 border border-gray-200 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap">
              {t('pausedBadge')}
            </span>
          )}
          {/* Menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(v => !v)}
              onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
              className="w-10 h-10 flex items-center justify-center rounded-md hover:bg-[#f0ece6] text-[#8a7e6e] hover:text-[#1a1a2e] transition-colors text-lg leading-none"
              aria-label={t('optionsAriaLabel')}
            >
              ···
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-[#e8e3dc] rounded-xl shadow-lg z-20 overflow-hidden">
                <button
                  onClick={() => { setMenuOpen(false); onDelete(signal.id) }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
                >
                  {t('deleteMenuItem')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      {signal.description && (
        <p className="text-xs text-[#8a7e6e] leading-relaxed line-clamp-2">{signal.description}</p>
      )}

      {/* Meta */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#8a7e6e]">
        <span>
          {signal.source_type === 'template'
            ? t('templatePrefix', {
                // tTemplates namespace is dashboard.signals.list.templates —
                // template_id maps 1:1 to a key there (hiring_role,
                // recent_funding, tech_stack_change). If the id is unknown
                // (edge case), fall back to the raw id string.
                label: signal.template_id
                  ? tTemplates(signal.template_id as 'hiring_role' | 'recent_funding' | 'tech_stack_change')
                  : '',
              })
            : t('customSignal')}
        </span>
        <span>·</span>
        <span>{t('matched', { count: signal.total_matches_count })}</span>
        <span>·</span>
        <span>{t('lastRun', { time: relativeTime(signal.last_run_at, t) })}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-[#f0ece6]">
        <button
          onClick={() => onRunClick(signal.id, signal.name)}
          disabled={!signal.is_active}
          title={signal.is_active ? undefined : t('runDisabledTitle')}
          className="flex items-center gap-1.5 text-xs text-[#3b6bef] border border-[#dde6fd] rounded-lg px-3 py-1.5 hover:bg-[#f0f4ff] transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:text-[#8a7e6e] disabled:border-[#e8e3dc] disabled:hover:bg-transparent"
        >
          ▶ {t('runOnCampaign')}
        </button>
        <div className="ml-auto">
          <button
            onClick={handleToggle}
            disabled={toggling}
            className="flex items-center gap-1.5 text-xs border border-[#e8e3dc] rounded-lg px-3 py-1.5 text-[#6b5e4e] hover:bg-[#f7f4f0] transition-colors disabled:opacity-50"
          >
            {toggling ? '…' : signal.is_active ? `⏸ ${t('pauseButton')}` : `▶ ${t('activateButton')}`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SignalsPage() {
  const t = useTranslations('dashboard.signals.list')
  const tCommon = useTranslations('dashboard.common')
  const router = useRouter()
  const [signals, setSignals] = useState<Signal[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [runModalSignal, setRunModalSignal] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    fetch('/api/signals')
      .then(r => r.json())
      .then(({ signals: s }) => {
        setSignals(s ?? [])
        setLoading(false)
      })
  }, [])

  function handleToggle(id: string, is_active: boolean) {
    setSignals(prev => prev.map(s => s.id === id ? { ...s, is_active } : s))
  }

  function handleCreated(signal: Signal) {
    setSignals(prev => [signal, ...prev])
    setModalOpen(false)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    await fetch(`/api/signals/${deleteTarget}`, { method: 'DELETE' }).catch(() => null)
    setSignals(prev => prev.filter(s => s.id !== deleteTarget))
    setDeleteTarget(null)
    setDeleting(false)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[#1a1a2e]">{t('title')}</h1>
            <Tooltip content={t('titleTooltip')} placement="bottom">
              <svg className="w-4 h-4 text-[#8a7e6e] cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </Tooltip>
          </div>
          <p className="text-sm text-[#8a7e6e]">{t('subtitle')}</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
        >
          + {t('newSignalButton')}
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-10 flex justify-center"><SpinnerWithText text={t('loadingSignals')} /></div>
      ) : signals.length === 0 ? (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center">
          <div className="text-3xl mb-3">📡</div>
          <h2 className="text-lg font-bold text-[#1a1a2e] mb-2">{t('emptyTitle')}</h2>
          <p className="text-sm text-[#8a7e6e] mb-6 max-w-sm mx-auto">
            {t('emptyDescription')}
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-block bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
          >
            + {t('emptyCta')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {signals.map(s => (
            <SignalCard
              key={s.id}
              signal={s}
              onToggle={handleToggle}
              onDelete={id => setDeleteTarget(id)}
              onRunClick={(id, name) => setRunModalSignal({ id, name })}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-4 sm:p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <h2 className="text-lg font-bold text-[#1a1a2e] mb-2">{t('deleteTitle')}</h2>
            <p className="text-sm text-[#8a7e6e] mb-6">
              {t('deleteBody')}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 border border-[#e8e3dc] text-[#1a1a2e] rounded-xl py-2.5 text-sm font-medium hover:bg-[#f7f4f0] transition-colors disabled:opacity-50"
              >
                {tCommon('cancel')}
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {deleting ? tCommon('deleting') : tCommon('delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      <SignalCreateModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
      />

      {runModalSignal && (
        <RunSignalModal
          isOpen={true}
          onClose={() => setRunModalSignal(null)}
          signalId={runModalSignal.id}
          signalName={runModalSignal.name}
          onComplete={() => router.refresh()}
        />
      )}
    </div>
  )
}
