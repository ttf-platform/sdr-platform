'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import SendingPreferencesPanel from '@/components/SendingPreferencesPanel'

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

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [showPrefs, setShowPrefs] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetch('/api/campaigns')
      .then(r => r.json())
      .then(({ campaigns: c }) => {
        setCampaigns(c ?? [])
        setLoading(false)
      })
  }, [])

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
          <Link href="/dashboard/campaigns/new" className="bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
            + New Campaign
          </Link>
        </div>
      </div>

      <SendingPreferencesPanel open={showPrefs} onClose={() => setShowPrefs(false)} />

      {loading ? (
        <div className="text-sm text-[#8a7e6e] py-10 text-center">Loading campaigns…</div>
      ) : campaigns.length === 0 ? (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center">
          <div className="text-3xl mb-3">✨</div>
          <h2 className="text-lg font-bold text-[#1a1a2e] mb-2">No campaigns yet</h2>
          <p className="text-sm text-[#8a7e6e] mb-6 max-w-xs mx-auto">
            Create your first campaign — Sentra AI will generate a 4-email sequence tailored to your ICP in seconds.
          </p>
          <Link href="/dashboard/campaigns/new"
            className="inline-block bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors">
            + New Campaign
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map(c => (
            <CampaignCard key={c.id} c={c} onDelete={id => setDeleteTarget(campaigns.find(x => x.id === id) ?? null)} />
          ))}
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
    </div>
  )
}
