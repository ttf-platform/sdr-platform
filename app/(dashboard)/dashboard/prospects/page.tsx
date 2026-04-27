'use client'
import { useState, useEffect, useRef } from 'react'
import { ImportCSVModal, ManualAddModal, PasteModal, type ImportResult } from '@/components/ProspectModals'

// ─── Types ────────────────────────────────────────────────────────────────────
type Prospect = {
  id: string; email: string
  first_name: string | null; last_name: string | null
  company: string | null; title: string | null
  linkedin_url: string | null; website: string | null
  status: string; source: string
  campaign_id: string | null
  campaigns: { id: string; name: string } | null
  added_at: string; last_activity_at: string | null
}
type Campaign = { id: string; name: string }

// ─── Constants ────────────────────────────────────────────────────────────────
const LIFECYCLE = ['Found', 'Emailed', 'Opened', 'Replied', 'Meeting'] as const
const STATUS_IDX: Record<string, number> = { found: 0, emailed: 1, opened: 2, replied: 3, meeting: 4 }
const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual', paste: 'Paste', csv_import: 'CSV', ai_discover: 'AI',
}

function fmt(n: number) { return n.toLocaleString() }
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── LifecyclePill ────────────────────────────────────────────────────────────
function LifecyclePill({ status }: { status: string }) {
  const current = STATUS_IDX[status] ?? 0
  return (
    <div className="flex items-center">
      {LIFECYCLE.map((s, i) => (
        <div key={s} className="flex items-center">
          {i > 0 && (
            <div className={`w-3 h-px mx-0.5 ${i <= current ? 'bg-[#3b6bef]' : 'bg-[#e8e3dc]'}`} />
          )}
          <div
            title={s}
            className={`w-2.5 h-2.5 rounded-full transition-colors ${
              i < current   ? 'bg-[#3b6bef]' :
              i === current ? 'bg-[#3b6bef] ring-2 ring-[#eef1fd]' :
                              'bg-[#e8e3dc]'
            }`}
          />
        </div>
      ))}
    </div>
  )
}

// ─── SidePanel ────────────────────────────────────────────────────────────────
function SidePanel({ prospect, onClose }: { prospect: Prospect; onClose: () => void }) {
  const current = STATUS_IDX[prospect.status] ?? 0
  const name = [prospect.first_name, prospect.last_name].filter(Boolean).join(' ')

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="w-full max-w-sm bg-white shadow-xl flex flex-col h-full overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#f0ece6]">
          <div>
            <div className="font-bold text-[#1a1a2e]">{name || prospect.email}</div>
            {prospect.title && <div className="text-xs text-[#8a7e6e]">{prospect.title}</div>}
          </div>
          <button onClick={onClose} className="text-[#8a7e6e] hover:text-[#1a1a2e] text-xl">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {/* Lifecycle */}
          <div>
            <div className="text-xs font-semibold text-[#6b5e4e] mb-3">Lifecycle</div>
            <div className="flex items-start justify-between relative">
              <div className="absolute top-2.5 left-[10%] right-[10%] h-px bg-[#e8e3dc]" />
              {LIFECYCLE.map((s, i) => (
                <div key={s} className="flex flex-col items-center gap-1.5 z-10">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center bg-white ${
                    i < current   ? 'border-[#3b6bef] bg-[#3b6bef]' :
                    i === current ? 'border-[#3b6bef]' :
                                    'border-[#e8e3dc]'
                  }`}>
                    {i < current   && <div className="w-2 h-2 bg-white rounded-full" />}
                    {i === current && <div className="w-2 h-2 bg-[#3b6bef] rounded-full" />}
                  </div>
                  <span className={`text-[9px] font-semibold ${i <= current ? 'text-[#3b6bef]' : 'text-[#b0a898]'}`}>{s}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Contact info */}
          <div>
            <div className="text-xs font-semibold text-[#6b5e4e] mb-2">Contact</div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-[#8a7e6e] text-xs w-4">✉</span>
                <span className="text-[#1a1a2e] truncate flex-1">{prospect.email}</span>
                <button onClick={() => navigator.clipboard.writeText(prospect.email)}
                  className="text-xs text-[#b0a898] hover:text-[#3b6bef] flex-shrink-0">copy</button>
              </div>
              {prospect.company && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[#8a7e6e] text-xs w-4">🏢</span>
                  <span className="text-[#1a1a2e]">{prospect.company}</span>
                </div>
              )}
              {prospect.linkedin_url && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[#8a7e6e] text-xs w-4 font-bold">in</span>
                  <a href={prospect.linkedin_url} target="_blank" rel="noopener noreferrer"
                    className="text-[#3b6bef] hover:underline truncate flex-1">{prospect.linkedin_url}</a>
                </div>
              )}
              {prospect.website && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[#8a7e6e] text-xs w-4">🌐</span>
                  <a href={prospect.website} target="_blank" rel="noopener noreferrer"
                    className="text-[#3b6bef] hover:underline truncate flex-1">{prospect.website}</a>
                </div>
              )}
            </div>
          </div>

          {/* Meta */}
          <div className="flex flex-col gap-1.5 text-xs">
            {prospect.campaigns && (
              <div className="flex justify-between">
                <span className="text-[#8a7e6e]">Campaign</span>
                <span className="text-[#3b6bef] font-medium">{prospect.campaigns.name}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-[#8a7e6e]">Source</span>
              <span className="text-[#4a4a5a]">{SOURCE_LABEL[prospect.source] ?? prospect.source}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8a7e6e]">Added</span>
              <span className="text-[#4a4a5a]">{fmtDate(prospect.added_at)}</span>
            </div>
            {prospect.last_activity_at && (
              <div className="flex justify-between">
                <span className="text-[#8a7e6e]">Last activity</span>
                <span className="text-[#4a4a5a]">{fmtDate(prospect.last_activity_at)}</span>
              </div>
            )}
          </div>

          {/* Notes placeholder */}
          <div>
            <div className="text-xs font-semibold text-[#6b5e4e] mb-2 flex items-center gap-2">
              Notes
              <span className="text-[10px] bg-[#f0ece6] text-[#8a7e6e] px-1.5 py-0.5 rounded font-normal">Coming soon</span>
            </div>
            <div className="border border-dashed border-[#e8e3dc] rounded-lg p-3 text-xs text-[#b0a898] text-center">
              Tags and notes in Sprint 16d
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function ProspectsPage() {
  const [prospects, setProspects]     = useState<Prospect[]>([])
  const [total, setTotal]             = useState(0)
  const [pages, setPages]             = useState(1)
  const [campaigns, setCampaigns]     = useState<Campaign[]>([])
  const [loading, setLoading]         = useState(true)
  const [page, setPage]               = useState(1)
  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter]     = useState('all')
  const [campaignFilter, setCampaignFilter] = useState('all')
  const [sourceFilter, setSourceFilter]     = useState('all')
  const [sort, setSort]               = useState('newest')
  const [selected, setSelected]       = useState<Prospect | null>(null)
  const [modal, setModal]             = useState<null | 'csv' | 'manual' | 'paste'>(null)
  const [refreshKey, setRefreshKey]   = useState(0)
  const [deleting, setDeleting]       = useState<string | null>(null)
  const searchTimeout                 = useRef<ReturnType<typeof setTimeout>>()

  // Campaigns list for filter dropdown
  useEffect(() => {
    fetch('/api/campaigns').then(r => r.json()).then(d => setCampaigns(d.campaigns ?? []))
  }, [])

  // Prospects fetch
  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: '50', sort })
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (campaignFilter !== 'all') params.set('campaign_id', campaignFilter)
    if (sourceFilter !== 'all') params.set('source', sourceFilter)
    if (search) params.set('search', search)

    fetch(`/api/prospects?${params}`)
      .then(r => r.json())
      .then(d => {
        setProspects(d.prospects ?? [])
        setTotal(d.total ?? 0)
        setPages(d.pages ?? 1)
        setLoading(false)
      })
  }, [page, statusFilter, campaignFilter, sourceFilter, sort, refreshKey])

  // Debounced search — reset page on new search
  useEffect(() => {
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => { setPage(1); setRefreshKey(k => k + 1) }, 350)
    return () => clearTimeout(searchTimeout.current)
  }, [search])

  function onImported(_res: ImportResult) { setRefreshKey(k => k + 1); setPage(1) }

  async function deleteOne(id: string) {
    setDeleting(id)
    await fetch(`/api/prospects/${id}`, { method: 'DELETE' })
    setDeleting(null)
    if (selected?.id === id) setSelected(null)
    setRefreshKey(k => k + 1)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Prospects</h1>
          <p className="text-sm text-[#8a7e6e]">
            {loading ? 'Loading…' : `${fmt(total)} prospect${total !== 1 ? 's' : ''} across ${campaigns.length} campaign${campaigns.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Find Prospects — coming Sprint 9 */}
          <button disabled
            title="AI prospect discovery — Sprint 9"
            className="border border-[#e8e3dc] bg-[#f7f4f0] text-[#b0a898] px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 cursor-not-allowed">
            🔍 Find Prospects
            <span className="text-[9px] bg-[#e8e3dc] text-[#8a7e6e] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide">Soon</span>
          </button>
          <button onClick={() => setModal('paste')}
            className="border border-[#e8e3dc] bg-white text-[#1a1a2e] px-3 py-2 rounded-lg text-sm font-medium hover:bg-[#f5f2ee]">
            Paste list
          </button>
          <button onClick={() => setModal('manual')}
            className="border border-[#e8e3dc] bg-white text-[#1a1a2e] px-3 py-2 rounded-lg text-sm font-medium hover:bg-[#f5f2ee]">
            Add manually
          </button>
          <button onClick={() => setModal('csv')}
            className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
            ⬆ Import CSV
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl p-4 mb-4 flex flex-col gap-3">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
          placeholder="Search by name, email, company…" />
        <div className="flex gap-2 flex-wrap items-center">
          {(['all','found','emailed','opened','replied','meeting'] as const).map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1) }}
              className={`text-xs px-3 py-1.5 rounded-lg border capitalize transition-colors ${statusFilter === s ? 'bg-[#3b6bef] text-white border-[#3b6bef]' : 'border-[#e8e3dc] text-[#6b5e4e] hover:bg-[#f5f2ee]'}`}>
              {s === 'all' ? 'All' : s}
            </button>
          ))}
          <select value={campaignFilter} onChange={e => { setCampaignFilter(e.target.value); setPage(1) }}
            className="border border-[#e8e3dc] rounded-lg px-3 py-1.5 text-sm text-[#6b5e4e] focus:outline-none">
            <option value="all">All Campaigns</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={sourceFilter} onChange={e => { setSourceFilter(e.target.value); setPage(1) }}
            className="border border-[#e8e3dc] rounded-lg px-3 py-1.5 text-sm text-[#6b5e4e] focus:outline-none">
            <option value="all">All Sources</option>
            <option value="manual">Manual</option>
            <option value="paste">Paste</option>
            <option value="csv_import">CSV</option>
          </select>
          <select value={sort} onChange={e => { setSort(e.target.value); setPage(1) }}
            className="border border-[#e8e3dc] rounded-lg px-3 py-1.5 text-sm text-[#6b5e4e] focus:outline-none">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden mb-4">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#f0ece6]">
              {['NAME', 'COMPANY', 'EMAIL', 'CAMPAIGN', 'LIFECYCLE', 'SOURCE', 'ADDED'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
              <th className="px-4 py-3 w-8" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-[#8a7e6e]">Loading…</td></tr>
            ) : prospects.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center">
                <div className="text-2xl mb-2">📋</div>
                <div className="text-sm font-semibold text-[#1a1a2e] mb-1">No prospects yet</div>
                <div className="text-xs text-[#8a7e6e]">Import a CSV or add prospects manually to get started.</div>
              </td></tr>
            ) : prospects.map(p => (
              <tr key={p.id} onClick={() => setSelected(p)}
                className="border-b border-[#f7f4f0] hover:bg-[#faf8f5] cursor-pointer">
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-[#1a1a2e]">
                    {[p.first_name, p.last_name].filter(Boolean).join(' ') || (
                      <span className="text-[#b0a898] font-normal">—</span>
                    )}
                  </div>
                  {p.title && <div className="text-xs text-[#8a7e6e]">{p.title}</div>}
                </td>
                <td className="px-4 py-3 text-sm text-[#4a4a5a]">{p.company || '—'}</td>
                <td className="px-4 py-3 text-sm text-[#8a7e6e]">{p.email}</td>
                <td className="px-4 py-3">
                  {p.campaigns
                    ? <span className="text-xs text-[#3b6bef] font-medium bg-[#eef1fd] px-2 py-0.5 rounded-full">{p.campaigns.name}</span>
                    : <span className="text-xs text-[#b0a898]">—</span>}
                </td>
                <td className="px-4 py-3"><LifecyclePill status={p.status} /></td>
                <td className="px-4 py-3">
                  <span className="text-xs text-[#6b5e4e] bg-[#f0ece6] px-2 py-0.5 rounded-full">
                    {SOURCE_LABEL[p.source] ?? p.source}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-[#8a7e6e] whitespace-nowrap">{fmtDate(p.added_at)}</td>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <button onClick={() => deleteOne(p.id)} disabled={deleting === p.id}
                    className="text-xs text-[#d0c8be] hover:text-red-500 transition-colors disabled:opacity-40">
                    {deleting === p.id ? '…' : '✕'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 mb-6">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-sm text-[#6b5e4e] disabled:opacity-40">← Prev</button>
          <span className="text-sm text-[#8a7e6e]">{page} / {pages}</span>
          <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
            className="border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-sm text-[#6b5e4e] disabled:opacity-40">Next →</button>
        </div>
      )}

      {/* Side panel */}
      {selected && <SidePanel prospect={selected} onClose={() => setSelected(null)} />}

      {/* Modals */}
      {modal === 'csv'    && <ImportCSVModal onClose={() => setModal(null)} onImported={onImported} />}
      {modal === 'manual' && <ManualAddModal onClose={() => setModal(null)} onImported={onImported} />}
      {modal === 'paste'  && <PasteModal     onClose={() => setModal(null)} onImported={onImported} />}
    </div>
  )
}
