'use client'
import { useEffect, useState, useRef } from 'react'
import { Tooltip } from '@/components/Tooltip'

// ─── Types ───────────────────────────────────────────────────────────────────
type Deal = {
  id: string; stage: string; amount: number | null; currency: string
  closed_reason: string | null; notes: string | null; source: string
  stage_changed_at: string; created_at: string; closed_at: string | null
  manual_override: boolean
  prospect_id: string; campaign_id: string | null
  contact_first_name: string | null; contact_last_name: string | null
  contact_company: string | null; contact_title: string | null
  contact_email: string | null; contact_linkedin: string | null
  campaign_name: string | null
}
type Stats = { totalLeads: number; activePipeline: number; winRate: number | null; totalCaWon: number; meetingsThisWeek: number }
type Contact = { id: string; first_name: string | null; last_name: string | null; company: string | null; primary_campaign_name: string | null }

// ─── Constants ────────────────────────────────────────────────────────────────
const STAGES = ['new_lead','contacted','opened','replied','interested','meeting_booked','proposal_sent','closed_won','closed_lost'] as const
type StageKey = typeof STAGES[number]
const STAGE_LABELS: Record<StageKey, string> = {
  new_lead:'New Lead', contacted:'Contacted', opened:'Opened', replied:'Replied',
  interested:'Interested', meeting_booked:'Meeting Booked', proposal_sent:'Proposal Sent',
  closed_won:'Closed Won', closed_lost:'Closed Lost',
}
const STAGE_COLORS: Record<StageKey, string> = {
  new_lead:'#8a7e6e', contacted:'#3b6bef', opened:'#6366f1', replied:'#8b5cf6',
  interested:'#f59e0b', meeting_booked:'#10b981', proposal_sent:'#06b6d4',
  closed_won:'#16a34a', closed_lost:'#ef4444',
}
const STAGE_HEADER: Record<StageKey, { bg: string; border: string }> = {
  new_lead:       { bg: 'bg-gray-50',    border: 'border-b-2 border-gray-400'    },
  contacted:      { bg: 'bg-blue-50',    border: 'border-b-2 border-blue-500'    },
  opened:         { bg: 'bg-purple-50',  border: 'border-b-2 border-purple-400'  },
  replied:        { bg: 'bg-green-50',   border: 'border-b-2 border-green-500'   },
  interested:     { bg: 'bg-orange-50',  border: 'border-b-2 border-orange-500'  },
  meeting_booked: { bg: 'bg-teal-50',    border: 'border-b-2 border-teal-500'    },
  proposal_sent:  { bg: 'bg-cyan-50',    border: 'border-b-2 border-cyan-500'    },
  closed_won:     { bg: 'bg-emerald-50', border: 'border-b-2 border-emerald-500' },
  closed_lost:    { bg: 'bg-red-50',     border: 'border-b-2 border-red-500'     },
}
const CLOSED_REASONS = [
  { value:'not_interested',    label:'Not interested' },
  { value:'no_budget',         label:'No budget' },
  { value:'bad_timing',        label:'Bad timing' },
  { value:'lost_to_competitor',label:'Lost to competitor' },
  { value:'other',             label:'Other' },
]
const KPI_TOOLTIPS = {
  totalLeads:       'Total deals across all stages, including closed ones.',
  activePipeline:   'Deals currently in progress (excludes Closed Won and Closed Lost).',
  winRate:          'Percentage of closed deals won. Calculated as Won / (Won + Lost).',
  meetingsThisWeek: 'Meetings scheduled between Monday and Sunday of the current week.',
  totalCaWon:       'Sum of amounts on all Closed Won deals (USD).',
}
const ADD_LEAD_TOOLTIP = 'Add a lead manually — for opportunities not coming from a Sentra campaign (e.g. inbound leads, networking, referrals).'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function daysInStage(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}
function displayName(d: Deal) {
  return [d.contact_first_name, d.contact_last_name].filter(Boolean).join(' ') || d.contact_email || '—'
}
function fmtAmount(n: number | null) {
  if (n == null) return null
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Info Icon ────────────────────────────────────────────────────────────────
function InfoIcon({ content, placement }: { content: string; placement?: 'top' | 'top-end' | 'bottom' | 'bottom-end' }) {
  return (
    <Tooltip content={content} placement={placement}>
      <svg className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 cursor-help flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
      </svg>
    </Tooltip>
  )
}

// ─── Deal Card ─────────────────────────────────────────────────────────────────
function DealCard({ deal, dragging, onDragStart, onDragEnd, onClick }: {
  deal: Deal; dragging: boolean
  onDragStart: () => void; onDragEnd: () => void; onClick: () => void
}) {
  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData('dealId', deal.id); e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`bg-white border rounded-lg p-3.5 mb-2.5 hover:border-gray-300 transition-colors cursor-grab active:cursor-grabbing select-none
        ${dragging ? 'opacity-40' : 'border-gray-200'}`}
    >
      <div className="font-semibold text-sm text-gray-900 mb-0.5 truncate">{displayName(deal)}</div>
      {(deal.contact_title || deal.contact_company) && (
        <div className="text-xs text-gray-400 mb-2 truncate">
          {deal.contact_title ? `${deal.contact_title} @ ` : ''}{deal.contact_company}
        </div>
      )}
      {deal.amount != null && (
        <div className="text-sm font-semibold text-green-600 mb-2">{fmtAmount(deal.amount)}</div>
      )}
      <div className="flex items-center justify-between mt-1">
        {deal.campaign_name ? (
          <span className="text-[0.68rem] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded truncate max-w-[120px]">
            {deal.campaign_name}
          </span>
        ) : (
          <span className="text-[0.68rem] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Manual</span>
        )}
        <span className="text-[0.68rem] text-gray-400 flex-shrink-0 ml-1">{daysInStage(deal.stage_changed_at)}d</span>
      </div>
    </div>
  )
}

// ─── Closed Deals Modal ────────────────────────────────────────────────────────
function ClosedDealsModal({ stage, deals, onClose, onDealClick }: {
  stage: 'closed_won' | 'closed_lost'
  deals: Deal[]
  onClose: () => void
  onDealClick: (deal: Deal) => void
}) {
  const [query, setQuery] = useState('')
  const title = stage === 'closed_won' ? 'Closed Won' : 'Closed Lost'
  const filtered = deals.filter(d => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return [d.contact_first_name, d.contact_last_name, d.contact_company, d.contact_email]
      .some(v => v?.toLowerCase().includes(q))
  })

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900">All {title} deals</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{deals.length} total</span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
          </div>
        </div>
        <div className="p-4 flex-shrink-0 border-b border-gray-100">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, company…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">No deals found</div>
          ) : filtered.map(deal => (
            <div key={deal.id} className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-50 hover:bg-gray-50">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-gray-900 truncate">{displayName(deal)}</div>
                {(deal.contact_title || deal.contact_company) && (
                  <div className="text-xs text-gray-400 truncate">
                    {deal.contact_title ? `${deal.contact_title} @ ` : ''}{deal.contact_company}
                  </div>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                {deal.amount != null && (
                  <div className="text-sm font-semibold text-green-600">{fmtAmount(deal.amount)}</div>
                )}
                <div className="text-xs text-gray-400">Closed {fmtDate(deal.closed_at)}</div>
              </div>
              <button
                onClick={() => { onClose(); onDealClick(deal) }}
                className="text-xs text-blue-600 hover:text-blue-800 flex-shrink-0 ml-2 whitespace-nowrap"
              >
                View →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Kanban View ───────────────────────────────────────────────────────────────
const CLOSED_COL_LIMIT = 10

function KanbanView({ deals, draggingId, dragOverStage, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, onCardClick, onOpenClosedView }: {
  deals: Deal[]; draggingId: string | null; dragOverStage: string | null
  onDragStart: (id: string) => void; onDragEnd: () => void
  onDragOver: (stage: string) => void; onDragLeave: () => void
  onDrop: (stage: string) => void; onCardClick: (deal: Deal) => void
  onOpenClosedView: (stage: 'closed_won' | 'closed_lost') => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft,  setCanScrollLeft]  = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  function checkScroll() {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 1)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    el?.addEventListener('scroll', checkScroll, { passive: true })
    window.addEventListener('resize', checkScroll)
    return () => {
      el?.removeEventListener('scroll', checkScroll)
      window.removeEventListener('resize', checkScroll)
    }
  }, [])

  useEffect(() => { checkScroll() }, [deals.length])

  return (
    <div className="relative">
      {canScrollLeft && <>
        <div className="absolute left-0 top-0 bottom-2 w-6 bg-gradient-to-r from-[#f5f2ee] to-transparent z-10 pointer-events-none rounded-l" />
        <button
          onClick={() => scrollRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
          className="absolute left-1 top-20 z-20 rounded-full bg-white border border-gray-200 shadow-md w-8 h-8 flex items-center justify-center hover:bg-gray-50 transition-colors text-gray-600 text-lg leading-none"
        >‹</button>
      </>}
      {canScrollRight && <>
        <div className="absolute right-0 top-0 bottom-2 w-6 bg-gradient-to-l from-[#f5f2ee] to-transparent z-10 pointer-events-none rounded-r" />
        <button
          onClick={() => scrollRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
          className="absolute right-1 top-20 z-20 rounded-full bg-white border border-gray-200 shadow-md w-8 h-8 flex items-center justify-center hover:bg-gray-50 transition-colors text-gray-600 text-lg leading-none"
        >›</button>
      </>}

      <div ref={scrollRef} className="overflow-x-auto pb-2">
        <div className="flex gap-3 min-w-max">
          {STAGES.map(stage => {
            const isClosed = stage === 'closed_won' || stage === 'closed_lost'
            const allInStage = deals.filter(d => d.stage === stage)
            const sorted = [...allInStage].sort((a, b) => {
              const at = isClosed ? (a.closed_at ?? a.stage_changed_at) : a.stage_changed_at
              const bt = isClosed ? (b.closed_at ?? b.stage_changed_at) : b.stage_changed_at
              return new Date(bt).getTime() - new Date(at).getTime()
            })
            const col = isClosed ? sorted.slice(0, CLOSED_COL_LIMIT) : sorted
            const hasMore = isClosed && allInStage.length > CLOSED_COL_LIMIT
            const isDragTarget = dragOverStage === stage
            const { bg, border } = STAGE_HEADER[stage]

            return (
              <div key={stage} className="w-56 flex-shrink-0 flex flex-col"
                onDragOver={e => { e.preventDefault(); onDragOver(stage) }}
                onDragLeave={onDragLeave}
                onDrop={e => { e.preventDefault(); onDrop(stage) }}>
                {/* Column header */}
                <div className={`px-4 py-3 ${bg} ${border} rounded-t-lg flex items-center justify-between`}>
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                    {STAGE_LABELS[stage]}
                  </span>
                  <span className="text-xs font-medium text-gray-500 bg-white px-2 py-0.5 rounded-full">
                    {allInStage.length}
                  </span>
                </div>
                {/* Drop zone body */}
                <div className={`flex-1 min-h-24 p-2 rounded-b-xl transition-colors
                  ${isDragTarget ? 'bg-blue-50 border-2 border-dashed border-blue-300' : 'bg-[#f9f7f4] border-2 border-transparent'}`}>
                  {col.map(deal => (
                    <DealCard key={deal.id} deal={deal}
                      dragging={draggingId === deal.id}
                      onDragStart={() => onDragStart(deal.id)}
                      onDragEnd={onDragEnd}
                      onClick={() => onCardClick(deal)}
                    />
                  ))}
                  {col.length === 0 && !isDragTarget && (
                    <div className="text-center py-4 text-xs text-gray-300">Empty</div>
                  )}
                  {hasMore && (
                    <button
                      onClick={() => onOpenClosedView(stage as 'closed_won' | 'closed_lost')}
                      className="text-xs text-blue-600 hover:underline px-2 py-2 w-full text-center"
                    >
                      View all ({allInStage.length}) →
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── List View ─────────────────────────────────────────────────────────────────
function ListView({ deals, onRowClick }: { deals: Deal[]; onRowClick: (deal: Deal) => void }) {
  const [sortCol, setSortCol] = useState<string>('created_at')
  const [sortAsc, setSortAsc] = useState(false)

  function toggleSort(col: string) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  const sorted = [...deals].sort((a, b) => {
    let av: any = a[sortCol as keyof Deal]
    let bv: any = b[sortCol as keyof Deal]
    if (typeof av === 'string') av = av.toLowerCase()
    if (typeof bv === 'string') bv = bv.toLowerCase()
    if (av == null) return 1; if (bv == null) return -1
    return sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
  })

  const SortIcon = ({ col }: { col: string }) => (
    <span className="ml-1 text-gray-300">{sortCol === col ? (sortAsc ? '↑' : '↓') : '↕'}</span>
  )
  const TH = ({ col, label }: { col: string; label: string }) => (
    <th className="border border-gray-200 px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 cursor-pointer hover:bg-gray-100 whitespace-nowrap"
      onClick={() => toggleSort(col)}>
      {label}<SortIcon col={col} />
    </th>
  )

  return (
    <div className="overflow-x-auto rounded-xl border border-[#e8e3dc]">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <TH col="contact_first_name" label="Lead" />
            <TH col="contact_company"    label="Company" />
            <TH col="stage"              label="Stage" />
            <TH col="amount"             label="Amount" />
            <TH col="campaign_name"      label="Source" />
            <TH col="stage_changed_at"   label="Days in stage" />
            <TH col="created_at"         label="Created" />
          </tr>
        </thead>
        <tbody>
          {sorted.map(deal => (
            <tr key={deal.id} className="hover:bg-[#faf8f5] cursor-pointer"
              onClick={() => onRowClick(deal)}>
              <td className="border border-gray-200 px-4 py-3 text-sm font-medium text-gray-900">{displayName(deal)}</td>
              <td className="border border-gray-200 px-4 py-3 text-sm text-gray-600">{deal.contact_company || '—'}</td>
              <td className="border border-gray-200 px-4 py-3">
                <span className="text-xs px-2 py-1 rounded-full font-medium text-white"
                  style={{ backgroundColor: STAGE_COLORS[deal.stage as StageKey] }}>
                  {STAGE_LABELS[deal.stage as StageKey]}
                </span>
              </td>
              <td className="border border-gray-200 px-4 py-3 text-sm text-gray-900">{fmtAmount(deal.amount) ?? '—'}</td>
              <td className="border border-gray-200 px-4 py-3">
                {deal.campaign_name
                  ? <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded">{deal.campaign_name}</span>
                  : <span className="text-xs text-gray-400">Manual</span>}
              </td>
              <td className="border border-gray-200 px-4 py-3 text-sm text-gray-600">{daysInStage(deal.stage_changed_at)}d</td>
              <td className="border border-gray-200 px-4 py-3 text-sm text-gray-400 whitespace-nowrap">{fmtDate(deal.created_at)}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">No deals found</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── Side Panel ────────────────────────────────────────────────────────────────
function DealSidePanel({ deal, onClose, onUpdated, onDeleted }: {
  deal: Deal; onClose: () => void
  onUpdated: (updated: Partial<Deal>) => void
  onDeleted: () => void
}) {
  const [editAmount, setEditAmount] = useState(String(deal.amount ?? ''))
  const [editNotes,  setEditNotes]  = useState(deal.notes ?? '')
  const [saving,     setSaving]     = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  async function saveEdits() {
    setSaving(true)
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: editAmount ? parseFloat(editAmount) : null, notes: editNotes || null }),
    })
    setSaving(false)
    if (res.ok) onUpdated({ amount: editAmount ? parseFloat(editAmount) : null, notes: editNotes || null })
  }

  async function handleDelete() {
    setDeleting(true)
    await fetch(`/api/deals/${deal.id}`, { method: 'DELETE' })
    setDeleting(false)
    onDeleted()
  }

  return (
    <div className="fixed inset-0 z-[60] flex">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="w-full max-w-sm bg-white shadow-xl flex flex-col" style={{ height: '100vh', overflowY: 'auto' }}>
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <div className="font-bold text-gray-900 text-base">{displayName(deal)}</div>
            {deal.contact_company && <div className="text-xs text-gray-400 mt-0.5">{deal.contact_company}</div>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl ml-2">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Deal</div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Stage</span>
                <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                  style={{ backgroundColor: STAGE_COLORS[deal.stage as StageKey] }}>
                  {STAGE_LABELS[deal.stage as StageKey]}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Source</span>
                <span className="text-xs text-gray-700 capitalize">{deal.source.replace('_', ' ')}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Created</span>
                <span className="text-xs text-gray-700">{fmtDate(deal.created_at)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Stage since</span>
                <span className="text-xs text-gray-700">{fmtDate(deal.stage_changed_at)} ({daysInStage(deal.stage_changed_at)}d)</span>
              </div>
              {deal.closed_at && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Closed</span>
                  <span className="text-xs text-gray-700">{fmtDate(deal.closed_at)}</span>
                </div>
              )}
              {deal.closed_reason && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Lost reason</span>
                  <span className="text-xs text-gray-700 capitalize">{deal.closed_reason.replace(/_/g, ' ')}</span>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Amount (USD)</label>
            <input type="number" min="0" step="100"
              value={editAmount}
              onChange={e => setEditAmount(e.target.value)}
              placeholder="e.g. 15000"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            />
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Prospect</div>
            <div className="flex flex-col gap-1.5">
              {deal.contact_email && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-300 text-xs w-4">✉</span>
                  <span className="text-xs text-gray-700 truncate">{deal.contact_email}</span>
                </div>
              )}
              {deal.contact_title && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-300 text-xs w-4">💼</span>
                  <span className="text-xs text-gray-700">{deal.contact_title}</span>
                </div>
              )}
              {deal.contact_linkedin && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-300 text-xs w-4 font-bold">in</span>
                  <a href={deal.contact_linkedin} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:underline truncate">LinkedIn</a>
                </div>
              )}
            </div>
          </div>

          {deal.campaign_name && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Campaign</div>
              <a href={`/dashboard/campaigns/${deal.campaign_id}`}
                className="text-xs text-blue-600 hover:underline font-medium">{deal.campaign_name}</a>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Notes</label>
            <textarea rows={3} value={editNotes} onChange={e => setEditNotes(e.target.value)}
              placeholder="Add notes..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-400"
            />
          </div>

          <button onClick={saveEdits} disabled={saving}
            className="bg-[#3b6bef] text-white py-2 rounded-lg text-sm font-semibold disabled:opacity-40 transition-opacity">
            {saving ? 'Saving…' : 'Save changes'}
          </button>

          <div className="border-t border-gray-100 pt-4">
            {!confirmDel ? (
              <button onClick={() => setConfirmDel(true)}
                className="text-xs text-red-400 hover:text-red-600 transition-colors w-full text-center">
                Delete deal
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setConfirmDel(false)}
                  className="flex-1 border border-gray-200 text-sm text-gray-600 py-1.5 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={handleDelete} disabled={deleting}
                  className="flex-1 bg-red-500 text-white text-sm py-1.5 rounded-lg font-medium disabled:opacity-40 hover:bg-red-600">
                  {deleting ? 'Deleting…' : 'Confirm delete'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Close Modal ───────────────────────────────────────────────────────────────
function CloseModal({ deal, targetStage, onCancel, onConfirm }: {
  deal: Deal; targetStage: string
  onCancel: () => void
  onConfirm: (data: { amount?: number; closed_reason?: string; notes?: string }) => void
}) {
  const isWon = targetStage === 'closed_won'
  const [amount, setAmount]   = useState(String(deal.amount ?? ''))
  const [reason, setReason]   = useState('')
  const [notes,  setNotes]    = useState('')

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-1">
          {isWon ? '🎉 Close as Won' : '❌ Close as Lost'}
        </h2>
        <p className="text-sm text-gray-500 mb-5">
          Closing <strong>{displayName(deal)}</strong> as {isWon ? 'Won' : 'Lost'}.
        </p>

        {isWon ? (
          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1">Closed amount (USD)</label>
            <input type="number" min="0" step="100" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="e.g. 15000"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400" />
            <p className="text-xs text-gray-400 mt-1">Optional — you can update this later</p>
          </div>
        ) : (
          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1">Reason</label>
            <select value={reason} onChange={e => setReason(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400">
              <option value="">Select a reason…</option>
              {CLOSED_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        )}

        <div className="mb-5">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1">Notes (optional)</label>
          <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder={isWon ? 'Closed after 3 follow-ups, demo on...' : 'What happened...'}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-gray-400"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel}
            className="border border-gray-200 text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onConfirm({
              amount: amount ? parseFloat(amount) : undefined,
              closed_reason: reason || undefined,
              notes: notes || undefined,
            })}
            className={`text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors ${
              isWon ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
            }`}>
            {isWon ? 'Mark as Won' : 'Mark as Lost'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Lead Modal ────────────────────────────────────────────────────────────
function AddLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (deal: Deal) => void }) {
  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState<Contact[]>([])
  const [selected, setSelected] = useState<Contact | null>(null)
  const [stage,    setStage]    = useState<StageKey>('new_lead')
  const [amount,   setAmount]   = useState('')
  const [notes,    setNotes]    = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const searchRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    clearTimeout(searchRef.current)
    if (!query.trim()) { setResults([]); return }
    searchRef.current = setTimeout(async () => {
      const res = await fetch(`/api/contacts?search=${encodeURIComponent(query)}&limit=10`)
      const d = await res.json()
      setResults(d.contacts ?? [])
    }, 300)
    return () => clearTimeout(searchRef.current)
  }, [query])

  async function submit() {
    if (!selected) return
    setSaving(true)
    setError('')
    const res = await fetch('/api/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: selected.id, stage,
        amount: amount ? parseFloat(amount) : null,
        notes: notes || null,
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setError(data.error ?? 'Failed to create deal'); return }
    onCreated(data.deal)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        {/* Header — no tooltip here, it lives on the page next to the button */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900">Add Lead</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>

        {/* Contact search */}
        <div className="mb-4">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1">Contact</label>
          {selected ? (
            <div className="flex items-center justify-between border border-blue-200 bg-blue-50 rounded-lg px-3 py-2">
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {[selected.first_name, selected.last_name].filter(Boolean).join(' ')}
                </div>
                <div className="text-xs text-gray-500">{selected.company}{selected.primary_campaign_name ? ` · ${selected.primary_campaign_name}` : ''}</div>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-700 text-xs">✕</button>
            </div>
          ) : (
            <div className="relative">
              <input value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search contacts by name or email…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
              {results.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                  {results.map(c => (
                    <div key={c.id} className="px-3 py-2.5 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0"
                      onClick={() => { setSelected(c); setQuery(''); setResults([]) }}>
                      <div className="text-sm font-medium text-gray-900">
                        {[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}
                      </div>
                      <div className="text-xs text-gray-400">
                        {c.company}{c.primary_campaign_name ? ` · ${c.primary_campaign_name}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mb-4">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1">Stage</label>
          <select value={stage} onChange={e => setStage(e.target.value as StageKey)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
            {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
        </div>

        <div className="mb-4">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1">Estimated amount (USD, optional)</label>
          <input type="number" min="0" step="100" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="e.g. 5000"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </div>

        <div className="mb-5">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1">Notes (optional)</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Context, intent signals..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-400" />
        </div>

        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="border border-gray-200 text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={!selected || saving}
            className="bg-[#3b6bef] text-white text-sm font-semibold px-5 py-2 rounded-lg disabled:opacity-40 transition-opacity">
            {saving ? 'Adding…' : 'Add to Pipeline'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function PipelinePage() {
  const [deals,          setDeals]          = useState<Deal[]>([])
  const [stats,          setStats]          = useState<Stats | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [view,           setView]           = useState<'kanban' | 'list'>('kanban')
  const [search,         setSearch]         = useState('')
  const [stageFilter,    setStageFilter]    = useState('all')
  const [syncing,        setSyncing]        = useState(false)
  const [toast,          setToast]          = useState<string | null>(null)
  const [closedViewStage, setClosedViewStage] = useState<'closed_won' | 'closed_lost' | null>(null)

  // Drag & drop
  const [draggingId,    setDraggingId]    = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)

  // Modals
  const [closeModal,  setCloseModal]  = useState<{ deal: Deal; targetStage: string } | null>(null)
  const [addLeadOpen, setAddLeadOpen] = useState(false)
  const [sidePanel,   setSidePanel]   = useState<Deal | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/deals').then(r => r.json()),
      fetch('/api/deals/stats').then(r => r.json()),
    ]).then(([d, s]) => {
      setDeals(d.deals ?? [])
      setStats(s)
      setLoading(false)
    })
  }, [])

  async function sync() {
    setSyncing(true)
    const res = await fetch('/api/deals/sync', { method: 'POST' })
    const d = await res.json()
    setSyncing(false)
    if (d.created > 0) {
      const fresh = await fetch('/api/deals').then(r => r.json())
      setDeals(fresh.deals ?? [])
      showToast(`✓ ${d.created} deal${d.created !== 1 ? 's' : ''} added from prospects`)
    } else {
      showToast('All prospects already have deals')
    }
    const s = await fetch('/api/deals/stats').then(r => r.json())
    setStats(s)
  }

  function handleDrop(targetStage: string) {
    if (!draggingId) return
    const deal = deals.find(d => d.id === draggingId)
    if (!deal || deal.stage === targetStage) { setDraggingId(null); setDragOverStage(null); return }

    if (targetStage === 'closed_won' || targetStage === 'closed_lost') {
      setCloseModal({ deal, targetStage })
      setDraggingId(null); setDragOverStage(null)
      return
    }
    moveStage(deal, targetStage)
  }

  async function moveStage(deal: Deal, newStage: string, extra?: { amount?: number; closed_reason?: string; notes?: string }) {
    const now = new Date().toISOString()
    const isClosed = newStage === 'closed_won' || newStage === 'closed_lost'
    setDeals(prev => prev.map(d => d.id === deal.id ? {
      ...d, stage: newStage, stage_changed_at: now, manual_override: true,
      ...(isClosed ? { closed_at: now } : {}),
      ...extra,
    } : d))
    setDraggingId(null); setDragOverStage(null)

    const res = await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: newStage, manual_override: true, ...extra }),
    })
    if (!res.ok) {
      setDeals(prev => prev.map(d => d.id === deal.id ? deal : d))
      showToast('Failed to update deal — changes reverted')
    } else {
      const s = await fetch('/api/deals/stats').then(r => r.json())
      setStats(s)
    }
  }

  async function confirmClose(data: { amount?: number; closed_reason?: string; notes?: string }) {
    if (!closeModal) return
    await moveStage(closeModal.deal, closeModal.targetStage, data)
    setCloseModal(null)
  }

  const filtered = deals.filter(d => {
    const matchSearch = !search ||
      [d.contact_first_name, d.contact_last_name, d.contact_company, d.contact_email]
        .some(v => v?.toLowerCase().includes(search.toLowerCase()))
    const matchStage = stageFilter === 'all' || d.stage === stageFilter
    return matchSearch && matchStage
  })

  // For "View all" closed modal — use unfiltered deals so nothing is hidden
  const closedViewDeals = closedViewStage
    ? [...deals.filter(d => d.stage === closedViewStage)].sort((a, b) =>
        new Date(b.closed_at ?? b.stage_changed_at).getTime() - new Date(a.closed_at ?? a.stage_changed_at).getTime()
      )
    : []

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Pipeline</h1>
          <p className="text-sm text-[#8a7e6e]">Track leads from first touch to closed deal</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end items-center">
          <button onClick={sync} disabled={syncing}
            className="border border-[#e8e3dc] bg-white text-[#1a1a2e] px-3 py-2 rounded-lg text-sm font-medium hover:bg-[#f5f2ee] disabled:opacity-40 transition-colors flex items-center gap-1.5">
            {syncing ? '↻ Syncing…' : '↻ Sync'}
          </button>
          <button onClick={() => setView('kanban')}
            className={`border px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'kanban' ? 'bg-[#3b6bef] text-white border-[#3b6bef]' : 'border-[#e8e3dc] bg-white text-[#1a1a2e] hover:bg-[#f5f2ee]'}`}>
            ⊞ Kanban
          </button>
          <button onClick={() => setView('list')}
            className={`border px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'list' ? 'bg-[#3b6bef] text-white border-[#3b6bef]' : 'border-[#e8e3dc] bg-white text-[#1a1a2e] hover:bg-[#f5f2ee]'}`}>
            ☰ List
          </button>
          {/* "+ Add Lead" button + tooltip — tight group, tooltip right-aligned to avoid viewport overflow */}
          <div className="flex items-center gap-1.5">
            <button onClick={() => setAddLeadOpen(true)}
              className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#2d5cd8] transition-colors">
              + Add Lead
            </button>
            <InfoIcon content={ADD_LEAD_TOOLTIP} placement="top-end" />
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-5">
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-4">
          <div className="flex items-center gap-1 mb-2">
            <span className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">Total Leads</span>
            <InfoIcon content={KPI_TOOLTIPS.totalLeads} />
          </div>
          <div className="text-3xl font-bold text-[#1a1a2e]">{loading ? '—' : stats?.totalLeads ?? 0}</div>
        </div>
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-4">
          <div className="flex items-center gap-1 mb-2">
            <span className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">Active Pipeline</span>
            <InfoIcon content={KPI_TOOLTIPS.activePipeline} />
          </div>
          <div className="text-3xl font-bold text-[#3b6bef]">{loading ? '—' : stats?.activePipeline ?? 0}</div>
        </div>
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-4">
          <div className="flex items-center gap-1 mb-2">
            <span className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">Win Rate</span>
            <InfoIcon content={KPI_TOOLTIPS.winRate} />
          </div>
          <div className="text-3xl font-bold text-green-600">
            {loading ? '—' : stats?.winRate != null ? `${stats.winRate}%` : '—'}
          </div>
        </div>
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-4">
          <div className="flex items-center gap-1 mb-2">
            <span className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">Meetings This Week</span>
            <InfoIcon content={KPI_TOOLTIPS.meetingsThisWeek} />
          </div>
          <div className="text-3xl font-bold text-[#1a1a2e]">{loading ? '—' : stats?.meetingsThisWeek ?? 0}</div>
        </div>
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-4">
          <div className="flex items-center gap-1 mb-2">
            <span className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">Total CA Won</span>
            <InfoIcon content={KPI_TOOLTIPS.totalCaWon} />
          </div>
          <div className="text-3xl font-bold text-green-600">
            {loading ? '—' : stats?.totalCaWon ? fmtAmount(stats.totalCaWon) : '$0'}
          </div>
          <div className="text-xs text-gray-400 mt-1">Closed deals total</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] bg-white"
          placeholder="Search leads…" />
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
          className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm text-[#6b5e4e] bg-white focus:outline-none">
          <option value="all">All stages</option>
          {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
      </div>

      {/* Views */}
      {loading ? (
        <div className="text-center py-16 text-sm text-gray-400">Loading pipeline…</div>
      ) : view === 'kanban' ? (
        <KanbanView
          deals={filtered}
          draggingId={draggingId}
          dragOverStage={dragOverStage}
          onDragStart={id => setDraggingId(id)}
          onDragEnd={() => { setDraggingId(null); setDragOverStage(null) }}
          onDragOver={stage => setDragOverStage(stage)}
          onDragLeave={() => setDragOverStage(null)}
          onDrop={handleDrop}
          onCardClick={deal => setSidePanel(deal)}
          onOpenClosedView={stage => setClosedViewStage(stage)}
        />
      ) : (
        <ListView deals={filtered} onRowClick={deal => setSidePanel(deal)} />
      )}

      {/* Side panel */}
      {sidePanel && (
        <DealSidePanel
          deal={sidePanel}
          onClose={() => setSidePanel(null)}
          onUpdated={updates => {
            setDeals(prev => prev.map(d => d.id === sidePanel.id ? { ...d, ...updates } : d))
            setSidePanel(prev => prev ? { ...prev, ...updates } : null)
          }}
          onDeleted={() => {
            setDeals(prev => prev.filter(d => d.id !== sidePanel.id))
            setSidePanel(null)
            fetch('/api/deals/stats').then(r => r.json()).then(setStats)
          }}
        />
      )}

      {/* Close Won/Lost modal */}
      {closeModal && (
        <CloseModal
          deal={closeModal.deal}
          targetStage={closeModal.targetStage}
          onCancel={() => setCloseModal(null)}
          onConfirm={confirmClose}
        />
      )}

      {/* Add Lead modal */}
      {addLeadOpen && (
        <AddLeadModal
          onClose={() => setAddLeadOpen(false)}
          onCreated={deal => {
            setDeals(prev => [deal, ...prev])
            setAddLeadOpen(false)
            showToast('✓ Deal added to pipeline')
            fetch('/api/deals/stats').then(r => r.json()).then(setStats)
          }}
        />
      )}

      {/* View all closed deals modal */}
      {closedViewStage && (
        <ClosedDealsModal
          stage={closedViewStage}
          deals={closedViewDeals}
          onClose={() => setClosedViewStage(null)}
          onDealClick={deal => setSidePanel(deal)}
        />
      )}
    </div>
  )
}
