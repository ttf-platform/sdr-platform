'use client'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import SendingPreferencesPanel from '@/components/SendingPreferencesPanel'
import { ChooseTemplateModal } from '@/components/ChooseTemplateModal'
import { NewCampaignModal } from '@/components/NewCampaignModal'
import type { CampaignTemplate } from '@/lib/campaign-templates'
import type { AISuggestion } from '@/lib/ai-suggestions'

interface Campaign {
  id: string; name: string; status: string; target_persona: string | null
  prospects_count: number; sent_count: number; replied_count: number; meeting_count: number
  created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  draft:     'bg-[#f0ece6] text-[#6b5e4e]',
  active:    'bg-green-50 text-green-700',
  paused:    'bg-amber-50 text-amber-700',
  completed: 'bg-blue-50 text-blue-700',
  archived:  'bg-gray-100 text-gray-500',
}

function CampaignCard({ c, onDelete }: { c: Campaign; onDelete: (id: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  return (
    <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 flex flex-col hover:border-[#c8d4e8] transition-colors">
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-bold text-[#1a1a2e] text-base leading-tight flex-1 pr-2">{c.name}</h3>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
            {c.status}
          </span>
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#f0ece6] text-[#8a7e6e] hover:text-[#1a1a2e] transition-colors text-lg leading-none"
              aria-label="Campaign options"
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
                  Open
                </Link>
                <button
                  onClick={() => { setMenuOpen(false); onDelete(c.id) }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
                >
                  Delete
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
          { label: 'PROSPECTS', value: c.prospects_count },
          { label: 'SENT',      value: c.sent_count },
          { label: 'REPLIES',   value: c.replied_count },
          { label: 'MEETINGS',  value: c.meeting_count },
        ].map(s => (
          <div key={s.label} className="text-center">
            <div className="text-base font-bold text-[#1a1a2e]">{s.value}</div>
            <div className="text-[10px] text-[#8a7e6e] uppercase tracking-wide">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-auto">
        <Link href={`/dashboard/campaigns/${c.id}`}
          className="inline-block bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          Open →
        </Link>
      </div>
    </div>
  )
}

function AISuggestionCard({ s, onLaunch }: { s: AISuggestion; onLaunch: () => void }) {
  return (
    <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 flex flex-col gap-3 hover:border-[#c8d4e8] transition-colors">
      <div>
        <span className="text-[9px] bg-[#6b4de6] text-white px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide">
          ✨ AI Suggestion
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
          🚀 Launch Campaign
        </button>
      </div>
    </div>
  )
}

type Tab = 'campaigns' | 'suggestions'

export default function CampaignsPage() {
  const searchParams = useSearchParams()
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

  async function loadSuggestions() {
    setSLoading(true)
    const res = await fetch('/api/campaigns/ai-suggestions').then(r => r.json())
    setSuggestions(res.suggestions ?? [])
    setSLoaded(true)
    setSLoading(false)
  }

  async function handleRefreshSuggestions() {
    setSLoading(true)
    const res = await fetch('/api/campaigns/ai-suggestions/refresh', { method: 'POST' }).then(r => r.json())
    if (res.suggestions) setSuggestions(res.suggestions)
    setSLoading(false)
  }

  function openChooseTemplate() { setChooseTemplate(true) }

  function handleTemplateSelect(template: CampaignTemplate) {
    setChooseTemplate(false)
    setPreset(template)
    setIsFromAI(false)
    setNewCampaign(true)
  }

  function handleLaunchFromAI(s: AISuggestion) {
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
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Campaigns</h1>
          <p className="text-sm text-[#8a7e6e]">Build and manage your outbound sequences</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowPrefs(v => !v)}
            className={`flex items-center gap-1.5 border px-3 py-2 rounded-lg text-sm font-medium ${showPrefs ? 'border-[#3b6bef] text-[#3b6bef] bg-[#3b6bef]/5' : 'border-[#e8e3dc] bg-white text-[#1a1a2e]'}`}>
            🕐 Sending Preferences
          </button>
          <button
            onClick={openChooseTemplate}
            className="bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            + New Campaign
          </button>
        </div>
      </div>

      <SendingPreferencesPanel open={showPrefs} onClose={() => setShowPrefs(false)} />

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-[#f0ece6] mb-6">
        {([
          { key: 'campaigns',   label: 'My Campaigns' },
          { key: 'suggestions', label: '✨ AI Suggestions' },
        ] as { key: Tab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.key
                ? 'border-[#3b6bef] text-[#3b6bef]'
                : 'border-transparent text-[#8a7e6e] hover:text-[#1a1a2e]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: My Campaigns */}
      {activeTab === 'campaigns' && (
        campaignsLoading ? (
          <div className="text-sm text-[#8a7e6e] py-10 text-center">Loading campaigns…</div>
        ) : campaigns.length === 0 ? (
          <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center">
            <div className="text-3xl mb-3">✨</div>
            <h2 className="text-lg font-bold text-[#1a1a2e] mb-2">No campaigns yet</h2>
            <p className="text-sm text-[#8a7e6e] mb-6 max-w-xs mx-auto">
              Create your first campaign — Sentra AI will write a personalized email sequence tailored to your ICP.
            </p>
            <button
              onClick={openChooseTemplate}
              className="inline-block bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
            >
              + New Campaign
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map(c => (
              <CampaignCard key={c.id} c={c} onDelete={id => setDeleteTarget(campaigns.find(x => x.id === id) ?? null)} />
            ))}
          </div>
        )
      )}

      {/* Tab: AI Suggestions */}
      {activeTab === 'suggestions' && (
        <div>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-bold text-[#1a1a2e]">✨ AI-Suggested Campaigns</h2>
              <p className="text-xs text-[#8a7e6e] mt-0.5">
                Sentra analyzes your ICP and product to suggest high-converting campaign strategies.
              </p>
            </div>
            <button
              onClick={handleRefreshSuggestions}
              disabled={suggestionsLoading}
              className="flex items-center gap-1.5 border border-[#e8e3dc] bg-white text-[#4a4a5a] px-3 py-2 rounded-lg text-sm font-medium hover:border-[#3b6bef] hover:text-[#3b6bef] transition-colors disabled:opacity-40"
            >
              ↻ Refresh suggestions
            </button>
          </div>

          {suggestionsLoading ? (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center">
              <div className="text-3xl mb-4">✨</div>
              <p className="text-sm font-medium text-[#1a1a2e] mb-1">Analyzing your product and ICP…</p>
              <p className="text-xs text-[#8a7e6e]">Generating strategic campaign ideas — up to 30 seconds</p>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center">
              <div className="text-3xl mb-3">💡</div>
              <h3 className="text-base font-bold text-[#1a1a2e] mb-2">No suggestions yet</h3>
              <p className="text-sm text-[#8a7e6e] mb-5 max-w-xs mx-auto">
                Complete your workspace profile (product, ICP) then generate AI campaign ideas.
              </p>
              <button
                onClick={handleRefreshSuggestions}
                className="bg-[#6b4de6] hover:bg-[#5a3ed4] text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
              >
                ✨ Generate suggestions
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {suggestions.map(s => (
                <AISuggestionCard key={s.id} s={s} onLaunch={() => handleLaunchFromAI(s)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h2 className="text-lg font-bold text-[#1a1a2e] mb-2">Delete campaign?</h2>
            <p className="text-sm text-[#8a7e6e] mb-6">
              <span className="font-semibold text-[#1a1a2e]">{deleteTarget.name}</span> and all its steps will be permanently deleted. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 border border-[#e8e3dc] text-[#1a1a2e] rounded-xl py-2.5 text-sm font-medium hover:bg-[#f7f4f0] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
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
