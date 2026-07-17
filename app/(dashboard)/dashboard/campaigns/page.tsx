'use client'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import SendingPreferencesPanel from '@/components/SendingPreferencesPanel'
import { ChooseTemplateModal } from '@/components/ChooseTemplateModal'
import { NewCampaignModal } from '@/components/NewCampaignModal'
import type { CampaignTemplate } from '@/lib/campaign-templates'
import type { AISuggestion } from '@/lib/ai-suggestions'
import { SpinnerWithText } from '@/components/ui/Spinner'
import { useOnboardingProgress } from '@/lib/hooks/useOnboardingProgress'

interface Campaign {
  id: string; name: string; status: string; target_persona: string | null
  prospects_count: number; sent_count: number; replied_count: number; meeting_count: number
  is_sample: boolean; created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  draft:     'bg-[#f0ece6] text-[#6b5e4e]',
  active:    'bg-green-50 text-green-700',
  paused:    'bg-amber-50 text-amber-700',
  completed: 'bg-blue-50 text-blue-700',
  archived:  'bg-gray-100 text-gray-500',
}

// Values only. Status labels resolved at render via useTranslations('...statuses') → t(c.status).
// Dynamic keys declared verbatim in messages/{en,fr}.json under dashboard.campaigns.list.statuses.*
const STATUSES = ['draft', 'active', 'paused', 'completed', 'archived'] as const

function CampaignCard({ c, onDelete }: { c: Campaign; onDelete: (id: string) => void }) {
  const t = useTranslations('dashboard.campaigns.list.card')
  const tCols = useTranslations('dashboard.campaigns.list.card.columns')
  const tStatuses = useTranslations('dashboard.campaigns.list.statuses')
  const tCommon = useTranslations('dashboard.common')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  const statusLabel = (STATUSES as readonly string[]).includes(c.status) ? tStatuses(c.status) : c.status

  return (
    <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 flex flex-col hover:border-[#c8d4e8] transition-colors">
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-bold text-[#1a1a2e] text-base leading-tight flex-1 pr-2 line-clamp-2">{c.name}</h3>
        <div className="flex items-center gap-2 flex-shrink-0">
          {c.is_sample && (
            <span className="text-[9px] bg-[#fff3cd] text-[#7a5c1a] border border-[#e8c96a] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide whitespace-nowrap">
              {t('demo')}
            </span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
            {statusLabel}
          </span>
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="w-10 h-10 flex items-center justify-center rounded-md hover:bg-[#f0ece6] text-[#8a7e6e] hover:text-[#1a1a2e] transition-colors text-lg leading-none"
              aria-label={t('optionsAriaLabel')}
            >
              ···
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-[#e8e3dc] rounded-xl shadow-lg z-20 overflow-hidden">
                <Link
                  href={`/dashboard/campaigns/${c.id}`}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#1a1a2e] hover:bg-[#f7f4f0] transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  {t('open')}
                </Link>
                <button
                  onClick={() => { setMenuOpen(false); onDelete(c.id) }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
                >
                  {tCommon('delete')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {c.target_persona && (
        <p className="text-xs text-[#8a7e6e] mb-3 line-clamp-2 leading-relaxed">{c.target_persona}</p>
      )}
      <div className="grid grid-cols-4 gap-2 py-3 border-t border-b border-[#f0ece6] mb-4">
        {[
          { key: 'prospects', value: c.prospects_count },
          { key: 'sent',      value: c.sent_count },
          { key: 'replies',   value: c.replied_count },
          { key: 'meetings',  value: c.meeting_count },
        ].map(s => (
          <div key={s.key} className="text-center">
            <div className="text-base font-bold text-[#1a1a2e]">{s.value}</div>
            <div className="text-[10px] text-[#8a7e6e] uppercase tracking-wide">{tCols(s.key)}</div>
          </div>
        ))}
      </div>
      <div className="mt-auto">
        <Link href={`/dashboard/campaigns/${c.id}`}
          className="inline-block bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          {t('openArrow')}
        </Link>
      </div>
    </div>
  )
}

// Blocking state shown wherever an ICP-gated action would be taken (new
// campaign empty state, AI suggestions tab). The header "+ New campaign"
// button surfaces the toast+CTA path via guardIcp() to keep the layout stable.
function IcpGateCard({
  tIcpGate,
}: {
  tIcpGate: (key: string) => string
}) {
  return (
    <div className="bg-white border border-[#e8e3dc] rounded-xl p-10 text-center">
      <div className="text-3xl mb-3">🎯</div>
      <h2 className="text-lg font-bold text-[#1a1a2e] mb-2">{tIcpGate('title')}</h2>
      <p className="text-sm text-[#8a7e6e] mb-6 max-w-md mx-auto">
        {tIcpGate('description')}
      </p>
      <Link
        href="/dashboard/profile#icp"
        className="inline-flex items-center gap-2 bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
      >
        {tIcpGate('cta')}
      </Link>
    </div>
  )
}

function AISuggestionCard({ s, onLaunch }: { s: AISuggestion; onLaunch: () => void }) {
  const t = useTranslations('dashboard.campaigns.list.suggestions')
  return (
    <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 flex flex-col gap-3 hover:border-[#c8d4e8] transition-colors">
      <div>
        <span className="text-[9px] bg-[#6b4de6] text-white px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide">
          ✨ {t('cardBadge')}
        </span>
      </div>

      <div>
        <h3 className="font-bold text-[#1a1a2e] text-sm leading-snug">{s.name}</h3>
        {s.target_persona && (
          <p className="text-xs text-[#8a7e6e] italic mt-1 leading-relaxed">{s.target_persona}</p>
        )}
      </div>

      {s.angle && (
        <div className="bg-[#eef1fd] border border-[#3b6bef]/20 rounded-lg px-3 py-2.5">
          <p className="text-xs text-[#3b6bef] leading-relaxed">{s.angle}</p>
        </div>
      )}

      {s.reasoning && (
        <p className="text-xs text-[#6b5e4e] leading-relaxed">{s.reasoning}</p>
      )}

      <div className="mt-auto pt-1">
        <button
          onClick={onLaunch}
          className="w-full bg-[#6b4de6] hover:bg-[#5a3ed4] text-white rounded-lg py-2 text-sm font-semibold transition-colors"
        >
          🚀 {t('cardLaunch')}
        </button>
      </div>
    </div>
  )
}

type Tab = 'campaigns' | 'suggestions'

export default function CampaignsPage() {
  const t = useTranslations('dashboard.campaigns.list')
  const tHeader = useTranslations('dashboard.campaigns.list.header')
  const tTabs = useTranslations('dashboard.campaigns.list.tabs')
  const tEmpty = useTranslations('dashboard.campaigns.list.emptyState')
  const tSuggestions = useTranslations('dashboard.campaigns.list.suggestions')
  const tDelete = useTranslations('dashboard.campaigns.list.deleteModal')
  const tCommon = useTranslations('dashboard.common')
  const tIcpGate = useTranslations('dashboard.campaigns.icpGate')

  const searchParams = useSearchParams()
  const { data: onboarding } = useOnboardingProgress()
  const [activeTab, setActiveTab]           = useState<Tab>('campaigns')
  const [campaigns, setCampaigns]           = useState<Campaign[]>([])
  const [campaignsLoading, setCLoading]     = useState(true)
  const [suggestions, setSuggestions]       = useState<AISuggestion[]>([])
  const [suggestionsLoading, setSLoading]   = useState(false)
  const [suggestionsLoaded, setSLoaded]     = useState(false)
  const [showPrefs, setShowPrefs]           = useState(false)
  const [deleteTarget, setDeleteTarget]     = useState<Campaign | null>(null)
  const [deleting, setDeleting]             = useState(false)
  const [chooseTemplate, setChooseTemplate] = useState(false)
  const [newCampaignOpen, setNewCampaign]   = useState(false)
  const [selectedPreset, setPreset]         = useState<CampaignTemplate | null>(null)
  const [isFromAI, setIsFromAI]             = useState(false)

  useEffect(() => {
    fetch('/api/campaigns')
      .then(r => r.json())
      .then(({ campaigns: c }) => {
        setCampaigns(c ?? [])
        setCLoading(false)
      })
  }, [])

  useEffect(() => {
    if (searchParams.get('action') === 'new') openChooseTemplate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleTabChange(tab: Tab) {
    setActiveTab(tab)
    if (tab === 'suggestions' && !suggestionsLoaded) {
      loadSuggestions()
    }
  }

  // Kept in sync with /api/onboarding/progress (icp_configured). When either
  // product_description or icp_description is empty, any LLM-consuming action
  // (create campaign, launch from AI suggestion, refresh suggestions) is
  // blocked at the button-click / tab-render level. The backend re-enforces
  // the same rule via assertIcpConfigured() — this frontend guard is UX only.
  const icpConfigured = onboarding?.completions.icp_configured === true

  function guardIcp(): boolean {
    if (icpConfigured) return true
    toast.error(tIcpGate('toastTitle'), {
      description: tIcpGate('toastDescription'),
      action: {
        label:   tIcpGate('toastCta'),
        onClick: () => { window.location.href = '/dashboard/profile#icp' },
      },
    })
    return false
  }

  async function loadSuggestions() {
    if (!icpConfigured) { setSLoaded(true); return }
    setSLoading(true)
    const res = await fetch('/api/campaigns/ai-suggestions').then(r => r.json())
    if (res?.error === 'icp_not_configured') { guardIcp(); setSLoading(false); setSLoaded(true); return }
    setSuggestions(res.suggestions ?? [])
    setSLoaded(true)
    setSLoading(false)
  }

  async function handleRefreshSuggestions() {
    if (!guardIcp()) return
    setSLoading(true)
    const res = await fetch('/api/campaigns/ai-suggestions/refresh', { method: 'POST' }).then(r => r.json())
    if (res?.error === 'icp_not_configured') { guardIcp(); setSLoading(false); return }
    if (res.suggestions) setSuggestions(res.suggestions)
    setSLoading(false)
  }

  function openChooseTemplate() {
    if (!guardIcp()) return
    setChooseTemplate(true)
  }

  function handleTemplateSelect(template: CampaignTemplate) {
    setChooseTemplate(false)
    setPreset(template)
    setIsFromAI(false)
    setNewCampaign(true)
  }

  function handleLaunchFromAI(s: AISuggestion) {
    if (!guardIcp()) return
    setPreset({
      id:             'ai-' + s.id,
      emoji:          '✨',
      label:          s.name,
      description:    s.reasoning ?? '',
      angle:          s.angle,
      value_prop:     s.value_prop,
      cta:            s.cta,
      target_persona: s.target_persona,
    })
    setIsFromAI(true)
    setNewCampaign(true)
  }

  function closeNewCampaign() {
    setNewCampaign(false)
    setPreset(null)
    setIsFromAI(false)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    await fetch(`/api/campaigns/${deleteTarget.id}`, { method: 'DELETE' }).catch(() => null)
    setCampaigns(prev => prev.filter(c => c.id !== deleteTarget.id))
    setDeleteTarget(null)
    setDeleting(false)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">{tHeader('title')}</h1>
          <p className="text-sm text-[#8a7e6e]">{tHeader('subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowPrefs(v => !v)}
            className={`flex items-center gap-1.5 border px-3 py-2 rounded-lg text-sm font-medium ${showPrefs ? 'border-[#3b6bef] text-[#3b6bef] bg-[#3b6bef]/5' : 'border-[#e8e3dc] bg-white text-[#1a1a2e]'}`}>
            🕐 {tHeader('sendingPreferences')}
          </button>
          <button
            onClick={openChooseTemplate}
            className="bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            + {tHeader('newCampaign')}
          </button>
        </div>
      </div>

      <SendingPreferencesPanel open={showPrefs} onClose={() => setShowPrefs(false)} />

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-[#f0ece6] mb-6">
        {([
          { key: 'campaigns',   label: tTabs('myCampaigns') },
          { key: 'suggestions', label: `✨ ${tTabs('aiSuggestions')}` },
        ] as { key: Tab; label: string }[]).map(tab => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? 'border-[#3b6bef] text-[#3b6bef]'
                : 'border-transparent text-[#8a7e6e] hover:text-[#1a1a2e]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: My Campaigns */}
      {activeTab === 'campaigns' && (
        campaignsLoading ? (
          <div className="py-10 flex justify-center"><SpinnerWithText text={t('loading')} /></div>
        ) : campaigns.length === 0 ? (
          !icpConfigured ? (
            <IcpGateCard tIcpGate={tIcpGate} />
          ) : (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center">
              <div className="text-3xl mb-3">✨</div>
              <h2 className="text-lg font-bold text-[#1a1a2e] mb-2">{tEmpty('title')}</h2>
              <p className="text-sm text-[#8a7e6e] mb-6 max-w-sm mx-auto">
                {tEmpty('description')}
              </p>
              <button
                onClick={openChooseTemplate}
                className="inline-block bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
              >
                + {tHeader('newCampaign')}
              </button>
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map(c => (
              <CampaignCard key={c.id} c={c} onDelete={id => setDeleteTarget(campaigns.find(x => x.id === id) ?? null)} />
            ))}
          </div>
        )
      )}

      {/* Tab: AI Suggestions */}
      {activeTab === 'suggestions' && (
        !icpConfigured ? (
          <IcpGateCard tIcpGate={tIcpGate} />
        ) : (
        <div>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-bold text-[#1a1a2e]">✨ {tSuggestions('title')}</h2>
              <p className="text-xs text-[#8a7e6e] mt-0.5">
                {tSuggestions('subtitle')}
              </p>
            </div>
            <button
              onClick={handleRefreshSuggestions}
              disabled={suggestionsLoading}
              className="flex items-center gap-1.5 border border-[#e8e3dc] bg-white text-[#4a4a5a] px-3 py-2 rounded-lg text-sm font-medium hover:border-[#3b6bef] hover:text-[#3b6bef] transition-colors disabled:opacity-40"
            >
              ↻ {tSuggestions('refresh')}
            </button>
          </div>

          {suggestionsLoading ? (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center">
              <div className="text-3xl mb-4">✨</div>
              <p className="text-sm font-medium text-[#1a1a2e] mb-1">{tSuggestions('analyzingTitle')}</p>
              <p className="text-xs text-[#8a7e6e]">{tSuggestions('analyzingSubtitle')}</p>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center">
              <div className="text-3xl mb-3">💡</div>
              <h3 className="text-base font-bold text-[#1a1a2e] mb-2">{tSuggestions('emptyTitle')}</h3>
              <p className="text-sm text-[#8a7e6e] mb-5 max-w-xs mx-auto">
                {tSuggestions('emptyDescription')}
              </p>
              <button
                onClick={handleRefreshSuggestions}
                className="bg-[#6b4de6] hover:bg-[#5a3ed4] text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
              >
                ✨ {tSuggestions('generateButton')}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {suggestions.map(s => (
                <AISuggestionCard key={s.id} s={s} onLaunch={() => handleLaunchFromAI(s)} />
              ))}
            </div>
          )}
        </div>
        )
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-4 sm:p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <h2 className="text-lg font-bold text-[#1a1a2e] mb-2">{tDelete('title')}</h2>
            <p className="text-sm text-[#8a7e6e] mb-6">
              {tDelete.rich('body', {
                name: deleteTarget.name,
                strong: chunks => <span className="font-semibold text-[#1a1a2e]">{chunks}</span>,
              })}
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

      {chooseTemplate && (
        <ChooseTemplateModal
          onSelect={handleTemplateSelect}
          onClose={() => setChooseTemplate(false)}
        />
      )}

      {newCampaignOpen && (
        <NewCampaignModal
          preset={selectedPreset}
          isFromAI={isFromAI}
          onClose={closeNewCampaign}
        />
      )}
    </div>
  )
}
