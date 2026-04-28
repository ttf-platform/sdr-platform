'use client'
import { useState, useEffect, useRef } from 'react'
import {
  ImportCSVModal, ManualAddModal, PasteModal,
  LifecyclePill, statusBadgeClass,
  type ImportResult,
} from '@/components/ProspectModals'

// ─── Types ────────────────────────────────────────────────────────────────────
type Contact = {
  id: string; email: string
  first_name: string | null; last_name: string | null
  company: string | null; title: string | null
  linkedin_url: string | null; website: string | null
  added_at: string
  campaigns_count: number
  primary_status: string
  last_activity_at: string | null
  primary_campaign_name: string | null
  primary_campaign_id: string | null
  primary_source: string | null
}

type Assignment = {
  id: string
  campaign_id: string | null
  status: string
  source: string
  added_at: string
  last_activity_at: string | null
  campaigns: { id: string; name: string } | null
}

type ContactDetail = Contact & { prospects: Assignment[] }
type Campaign = { id: string; name: string }

// ─── Constants ────────────────────────────────────────────────────────────────
const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual', paste: 'Paste', csv_import: 'CSV',
}

function fmt(n: number) { return n.toLocaleString() }
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── SidePanel ────────────────────────────────────────────────────────────────
function SidePanel({ contactId, onClose, onDeleted }: {
  contactId: string
  onClose: () => void
  onDeleted: () => void
}) {
  const [detail, setDetail]   = useState<ContactDetail | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setDetail(null)
    fetch(`/api/contacts/${contactId}`)
      .then(r => r.json())
      .then(d => setDetail(d.contact ?? null))
  }, [contactId])

  async function deleteContact() {
    setDeleting(true)
    await fetch(`/api/contacts/${contactId}`, { method: 'DELETE' })
    setDeleting(false)
    onDeleted()
    onClose()
  }

  const name = detail ? [detail.first_name, detail.last_name].filter(Boolean).join(' ') : ''

  return (
    <div className="fixed inset-0 z-[60] flex">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      {/* z-[60] > sticky header z-50 */}
      <div className="w-full max-w-sm bg-white shadow-xl flex flex-col overflow-y-auto" style={{ height: '100vh' }}>
        <div className="flex items-center justify-between p-5 border-b border-[#f0ece6]">
          <div>
            {detail ? (
              <>
                <div className="font-bold text-[#1a1a2e]">{name || detail.email}</div>
                {detail.title && <div className="text-xs text-[#8a7e6e]">{detail.title}</div>}
              </>
            ) : (
              <div className="w-32 h-4 bg-[#f0ece6] rounded animate-pulse" />
            )}
          </div>
          <button onClick={onClose} className="text-[#8a7e6e] hover:text-[#1a1a2e] text-xl">✕</button>
        </div>

        {!detail ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-[#3b6bef]/30 border-t-[#3b6bef] rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-5 flex flex-col gap-5">
            {/* Campaign assignments — one card per campaign */}
            {(() => {
              const campaignAssignments = (detail.prospects ?? []).filter(a => a.campaign_id)
              if (campaignAssignments.length === 0) return (
                <div>
                  <div className="text-xs font-semibold text-[#6b5e4e] mb-2">Campaigns</div>
                  <div className="text-xs text-[#b0a898]">Not assigned to any campaign</div>
                </div>
              )
              return (
                <div>
                  <div className="text-xs font-semibold text-[#6b5e4e] mb-2">
                    Campaigns ({campaignAssignments.length})
                  </div>
                  <div className="flex flex-col gap-2">
                    {campaignAssignments.map(a => (
                      <div key={a.id} className="border border-[#f0ece6] rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2.5">
                          <span className="text-xs font-medium text-[#3b6bef] truncate flex-1 mr-2">
                            {a.campaigns?.name ?? '—'}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium flex-shrink-0 ${statusBadgeClass(a.status)}`}>
                            {a.status}
                          </span>
                        </div>
                        <LifecyclePill status={a.status} variant="panel" />
                        {a.added_at && (
                          <div className="text-[10px] text-[#b0a898] mt-2">Added {fmtDate(a.added_at)}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Contact info */}
            <div>
              <div className="text-xs font-semibold text-[#6b5e4e] mb-2">Contact</div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[#8a7e6e] text-xs w-4">✉</span>
                  <span className="text-[#1a1a2e] truncate flex-1">{detail.email}</span>
                  <button onClick={() => navigator.clipboard.writeText(detail.email)}
                    className="text-xs text-[#b0a898] hover:text-[#3b6bef] flex-shrink-0">copy</button>
                </div>
                {detail.company && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-[#8a7e6e] text-xs w-4">🏢</span>
                    <span className="text-[#1a1a2e]">{detail.company}</span>
                  </div>
                )}
                {detail.linkedin_url && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-[#8a7e6e] text-xs w-4 font-bold">in</span>
                    <a href={detail.linkedin_url} target="_blank" rel="noopener noreferrer"
                      className="text-[#3b6bef] hover:underline truncate flex-1">{detail.linkedin_url}</a>
                  </div>
                )}
                {detail.website && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-[#8a7e6e] text-xs w-4">🌐</span>
                    <a href={detail.website} target="_blank" rel="noopener noreferrer"
                      className="text-[#3b6bef] hover:underline truncate flex-1">{detail.website}</a>
                  </div>
                )}
              </div>
            </div>

            {/* Meta */}
            <div className="flex flex-col gap-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[#8a7e6e]">Added</span>
                <span className="text-[#4a4a5a]">{fmtDate(detail.added_at)}</span>
              </div>
              {detail.last_activity_at && (
                <div className="flex justify-between">
                  <span className="text-[#8a7e6e]">Last activity</span>
                  <span className="text-[#4a4a5a]">{fmtDate(detail.last_activity_at)}</span>
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

            {/* Delete */}
            <button onClick={deleteContact} disabled={deleting}
              className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 text-center py-1 transition-colors">
              {deleting ? 'Deleting…' : 'Delete contact & all assignments'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function ProspectsPage() {
  const [contacts, setContacts]     = useState<Contact[]>([])
  const [total, setTotal]           = useState(0)
  const [pages, setPages]           = useState(1)
  const [campaigns, setCampaigns]   = useState<Campaign[]>([])
  const [loading, setLoading]       = useState(true)
  const [page, setPage]             = useState(1)
  const [search, setSearch]         = useState('')
  const [statusFilter, setStatusFilter]     = useState('all')
  const [campaignFilter, setCampaignFilter] = useState('all')
  const [sourceFilter, setSourceFilter]     = useState('all')
  const [sort, setSort]             = useState('newest')
  const [selectedPanel, setSelectedPanel]   = useState<string | null>(null)
  const [modal, setModal]           = useState<null | 'csv' | 'manual' | 'paste'>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [deleting, setDeleting]     = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const searchTimeout               = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    fetch('/api/campaigns').then(r => r.json()).then(d => setCampaigns(d.campaigns ?? []))
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: '50', sort })
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (campaignFilter !== 'all') params.set('campaign_id', campaignFilter)
    if (sourceFilter !== 'all') params.set('source', sourceFilter)
    if (search) params.set('search', search)

    fetch(`/api/contacts?${params}`)
      .then(r => r.json())
      .then(d => {
        setContacts(d.contacts ?? [])
        setTotal(d.total ?? 0)
        setPages(d.pages ?? 1)
        setLoading(false)
      })
  }, [page, statusFilter, campaignFilter, sourceFilter, sort, refreshKey])

  useEffect(() => {
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => { setPage(1); setRefreshKey(k => k + 1) }, 350)
    return () => clearTimeout(searchTimeout.current)
  }, [search])

  function onImported(_res: ImportResult) {
    setRefreshKey(k => k + 1)
    setPage(1)
    setSelectedIds(new Set())
  }

  async function deleteOne(id: string) {
    setDeleting(id)
    await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
    setDeleting(null)
    if (selectedPanel === id) setSelectedPanel(null)
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
    setRefreshKey(k => k + 1)
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return
    setBulkDeleting(true)
    await fetch('/api/contacts/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selectedIds] }),
    })
    setBulkDeleting(false)
    if (selectedPanel && selectedIds.has(selectedPanel)) setSelectedPanel(null)
    setSelectedIds(new Set())
    setRefreshKey(k => k + 1)
  }

  const allSelected = contacts.length > 0 && contacts.every(c => selectedIds.has(c.id))

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(prev => { const n = new Set(prev); contacts.forEach(c => n.delete(c.id)); return n })
    } else {
      setSelectedIds(prev => { const n = new Set(prev); contacts.forEach(c => n.add(c.id)); return n })
    }
  }

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
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
          <div className="w-px h-4 bg-[#e8e3dc] mx-1" />
          {(['bounced','unsubscribed'] as const).map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1) }}
              className={`text-xs px-3 py-1.5 rounded-lg border capitalize transition-colors ${statusFilter === s ? 'bg-red-500 text-white border-red-500' : 'border-[#e8e3dc] text-red-400 hover:bg-red-50'}`}>
              {s}
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
            {/* ai_discover / ai_enrich hidden — Sprint 9 Clay integration */}
          </select>
          <select value={sort} onChange={e => { setSort(e.target.value); setPage(1) }}
            className="border border-[#e8e3dc] rounded-lg px-3 py-1.5 text-sm text-[#6b5e4e] focus:outline-none">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name A–Z</option>
            <option value="name_z">Name Z–A</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden mb-4">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#f0ece6]">
              <th className="px-4 py-3 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  className="rounded border-[#e8e3dc] text-[#3b6bef] cursor-pointer" />
              </th>
              {['NAME', 'COMPANY', 'EMAIL', 'CAMPAIGNS', 'LIFECYCLE', 'SOURCE', 'ADDED'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
              <th className="px-4 py-3 w-8" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-[#8a7e6e]">Loading…</td></tr>
            ) : contacts.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-12 text-center">
                <div className="text-2xl mb-2">📋</div>
                <div className="text-sm font-semibold text-[#1a1a2e] mb-1">No prospects yet</div>
                <div className="text-xs text-[#8a7e6e]">Import a CSV or add prospects manually to get started.</div>
              </td></tr>
            ) : contacts.map(c => (
              <tr key={c.id} onClick={() => setSelectedPanel(c.id)}
                className={`border-b border-[#f7f4f0] hover:bg-[#faf8f5] cursor-pointer ${selectedIds.has(c.id) ? 'bg-[#f5f7ff]' : ''}`}>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleOne(c.id)}
                    className="rounded border-[#e8e3dc] text-[#3b6bef] cursor-pointer" />
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-[#1a1a2e]">
                    {[c.first_name, c.last_name].filter(Boolean).join(' ') || (
                      <span className="text-[#b0a898] font-normal">—</span>
                    )}
                  </div>
                  {c.title && <div className="text-xs text-[#8a7e6e]">{c.title}</div>}
                </td>
                <td className="px-4 py-3 text-sm text-[#4a4a5a]">{c.company || '—'}</td>
                <td className="px-4 py-3 text-sm text-[#8a7e6e]">{c.email}</td>
                <td className="px-4 py-3">
                  {c.campaigns_count === 0 ? (
                    <span className="text-xs text-[#b0a898]">—</span>
                  ) : c.campaigns_count === 1 ? (
                    <span className="text-xs text-[#3b6bef] font-medium bg-[#eef1fd] px-2 py-0.5 rounded-full truncate max-w-[120px] inline-block">
                      {c.primary_campaign_name ?? '1 campaign'}
                    </span>
                  ) : (
                    <span className="text-xs text-[#3b6bef] font-medium bg-[#eef1fd] px-2 py-0.5 rounded-full">
                      {c.campaigns_count} campaigns
                    </span>
                  )}
                </td>
                <td className="px-4 py-3"><LifecyclePill status={c.primary_status} /></td>
                <td className="px-4 py-3">
                  <span className="text-xs text-[#6b5e4e] bg-[#f0ece6] px-2 py-0.5 rounded-full">
                    {SOURCE_LABEL[c.primary_source ?? ''] ?? c.primary_source ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-[#8a7e6e] whitespace-nowrap">{fmtDate(c.added_at)}</td>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <button onClick={() => deleteOne(c.id)} disabled={deleting === c.id}
                    className="text-xs text-[#d0c8be] hover:text-red-500 transition-colors disabled:opacity-40">
                    {deleting === c.id ? '…' : '✕'}
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

      {/* Bulk select sticky bar — appears when items are selected */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-50 flex justify-center pb-6 pointer-events-none">
          <div className="pointer-events-auto bg-[#1a1a2e] text-white rounded-2xl shadow-xl px-5 py-3 flex items-center gap-4">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <button onClick={() => setSelectedIds(new Set())}
              className="text-xs text-white/60 hover:text-white/90 transition-colors">Clear</button>
            <button onClick={bulkDelete} disabled={bulkDeleting}
              className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-1.5 rounded-lg disabled:opacity-40 transition-colors">
              {bulkDeleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      {/* Side panel */}
      {selectedPanel && (
        <SidePanel
          contactId={selectedPanel}
          onClose={() => setSelectedPanel(null)}
          onDeleted={() => {
            setSelectedIds(prev => { const n = new Set(prev); n.delete(selectedPanel); return n })
            setRefreshKey(k => k + 1)
          }}
        />
      )}

      {/* Modals */}
      {modal === 'csv'    && <ImportCSVModal campaigns={campaigns} onClose={() => setModal(null)} onImported={onImported} />}
      {modal === 'manual' && <ManualAddModal campaigns={campaigns} onClose={() => setModal(null)} onImported={onImported} />}
      {modal === 'paste'  && <PasteModal     campaigns={campaigns} onClose={() => setModal(null)} onImported={onImported} />}
    </div>
  )
}
