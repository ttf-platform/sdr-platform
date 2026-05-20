'use client'
import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ImportCSVModal, ManualAddModal, PasteModal,
  LifecyclePill, statusBadgeClass,
  type ImportResult,
} from '@/components/ProspectModals'
import ProfileQualityBadge from '@/components/ProfileQualityBadge'
import { Tooltip } from '@/components/Tooltip'
import { StatusBadge } from '@/components/StatusBadge'
import { Tag } from '@/components/Tag'
import { TagPicker } from '@/components/TagPicker'
import { CreateTagModal } from '@/components/CreateTagModal'
import { NoteItem } from '@/components/NoteItem'
import { TagFilterDropdown } from '@/components/TagFilterDropdown'
import { ExportProspectsModal } from '@/components/ExportProspectsModal'

// ─── Types ────────────────────────────────────────────────────────────────────
type LifecycleCounts = {
  found: number; emailed: number; opened: number; replied: number; meeting: number
  bounced: number; unsubscribed: number
}

type ProspectTag = { id: string; label: string; color: string }

type Contact = {
  id: string; email: string
  first_name: string | null; last_name: string | null
  company: string | null; title: string | null
  linkedin_url: string | null; website: string | null
  added_at: string
  campaigns_count: number
  lifecycle_counts: LifecycleCounts
  primary_status: string
  last_activity_at: string | null
  primary_campaign_name: string | null
  primary_campaign_id: string | null
  primary_source: string | null
  tags: ProspectTag[]
}

type ProspectNote = {
  id: string; content: string
  created_at: string; updated_at: string
  author_id: string | null
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

const COMPANY_SIZES  = ['1-10', '10-50', '50-200', '200-500', '500-1000', '1000+']
const REVENUE_RANGES = ['<$1M', '$1M-$5M', '$5M-$10M', '$10M-$50M', '$50M-$200M', '$200M+']
const TONES          = ['Professional', 'Casual', 'Direct', 'Friendly', 'Witty']

const ICP_TOOLTIP         = 'These are your master defaults. They auto-fill every new campaign you create — and you can override any field per campaign at launch.'
const PAIN_POINTS_TOOLTIP = 'Describe the problems your prospects face that your product solves. Examples: struggling with low email deliverability, spending 3+ hours/day on manual prospecting, missing quota due to lack of qualified leads.'

const inputCls = 'w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#7c3aed]'
const labelCls = 'text-xs font-semibold text-[#6b5e4e]'

function fmt(n: number) { return n.toLocaleString() }
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function FieldOk({ show }: { show: boolean }) {
  if (!show) return null
  return <p className="text-xs mt-1 text-green-600">Ok ✓</p>
}

function InfoIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

// ─── Lifecycle multi-campaign dots ─────────────────────────────────────────────
const LC_POSITIVE = ['found', 'emailed', 'opened', 'replied', 'meeting'] as const
const LC_NEGATIVE = ['bounced', 'unsubscribed'] as const

function LifecycleCountsCell({ counts, total }: { counts: LifecycleCounts; total: number }) {
  const hasNeg = LC_NEGATIVE.some(s => (counts[s] ?? 0) > 0)
  return (
    <div className="flex items-center gap-1">
      {/* Positive dots */}
      {LC_POSITIVE.map((s, i) => {
        const n = counts[s] ?? 0
        const on = n > 0
        const label = s.charAt(0).toUpperCase() + s.slice(1)
        return (
          <div key={s} className="flex items-center">
            {i > 0 && <div className="w-2 h-px bg-[#e8e3dc] mx-0.5 mt-[10px]" />}
            <Tooltip content={`${n} of ${total} campaign${total !== 1 ? 's' : ''} reached ${label}`}>
              <div className="flex flex-col items-center gap-[2px]">
                <span className={`text-[9px] font-semibold leading-none ${on ? 'text-green-600' : 'text-[#d0cbc5]'}`}>{n}</span>
                <div className={`w-2 h-2 rounded-full ${on ? 'bg-green-500' : 'bg-[#e8e3dc]'}`} />
              </div>
            </Tooltip>
          </div>
        )
      })}
      {/* Separator + negative */}
      {hasNeg && (
        <>
          <div className="w-px h-5 bg-[#e8e3dc] mx-0.5" />
          {LC_NEGATIVE.map(s => {
            const n = counts[s] ?? 0
            if (!n) return null
            const label = s.charAt(0).toUpperCase() + s.slice(1)
            return (
              <Tooltip key={s} content={`${n} campaign${n !== 1 ? 's' : ''} ${label}`}>
                <div className="flex flex-col items-center gap-[2px]">
                  <span className="text-[9px] font-semibold leading-none text-red-400">{n}</span>
                  <div className="w-2 h-2 rounded-full bg-red-400" />
                </div>
              </Tooltip>
            )
          })}
        </>
      )}
    </div>
  )
}

// ─── SidePanel ────────────────────────────────────────────────────────────────
function SidePanel({ contactId, currentUserId, onClose, onDeleted, onContactTagsUpdated }: {
  contactId:             string
  currentUserId:         string | null
  onClose:               () => void
  onDeleted:             () => void
  onContactTagsUpdated:  (contactId: string, tags: ProspectTag[]) => void
}) {
  const [detail,   setDetail]   = useState<ContactDetail | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Tags state
  const [tags,           setTags]           = useState<ProspectTag[]>([])
  const [showTagPicker,  setShowTagPicker]  = useState(false)
  const [createTagLabel, setCreateTagLabel] = useState<string | null>(null)

  // Notes state
  const [notes,    setNotes]    = useState<ProspectNote[]>([])
  const [newNote,  setNewNote]  = useState('')
  const [addingNote, setAddingNote] = useState(false)

  // Primary prospect ID (first in list — used for tags + notes API calls)
  const primaryProspectId = detail?.prospects?.[0]?.id ?? null

  useEffect(() => {
    setDetail(null)
    setTags([])
    setNotes([])
    fetch(`/api/contacts/${contactId}`)
      .then(r => r.json())
      .then(d => setDetail(d.contact ?? null))
  }, [contactId])

  // Load tags + notes once we have the primary prospect
  useEffect(() => {
    if (!primaryProspectId) return
    Promise.all([
      fetch(`/api/prospects/${primaryProspectId}/tags`).then(r => r.json()),
      fetch(`/api/prospects/${primaryProspectId}/notes`).then(r => r.json()),
    ]).then(([td, nd]) => {
      setTags(td.tags ?? [])
      setNotes(nd.notes ?? [])
    })
  }, [primaryProspectId])

  async function handleAssignTag(tag: ProspectTag) {
    if (!primaryProspectId) return
    // Optimistic add
    setTags(prev => {
      if (prev.some(t => t.id === tag.id)) return prev
      const next = [...prev, tag]
      onContactTagsUpdated(contactId, next)
      return next
    })
    try {
      await fetch(`/api/prospects/${primaryProspectId}/tags`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tag_id: tag.id }),
      })
    } catch {
      // Rollback
      setTags(prev => {
        const next = prev.filter(t => t.id !== tag.id)
        onContactTagsUpdated(contactId, next)
        return next
      })
    }
  }

  async function handleRemoveTag(tagId: string) {
    if (!primaryProspectId) return
    // Optimistic remove
    setTags(prev => {
      const next = prev.filter(t => t.id !== tagId)
      onContactTagsUpdated(contactId, next)
      return next
    })
    try {
      const res = await fetch(`/api/prospects/${primaryProspectId}/tags/${tagId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
    } catch {
      // Rollback — re-fetch from API to restore accurate state
      fetch(`/api/prospects/${primaryProspectId}/tags`)
        .then(r => r.json())
        .then(d => {
          const restored = d.tags ?? []
          setTags(restored)
          onContactTagsUpdated(contactId, restored)
        })
    }
  }

  function handleTagCreated(tag: ProspectTag) {
    setTags(prev => {
      if (prev.some(t => t.id === tag.id)) return prev
      const next = [...prev, tag]
      onContactTagsUpdated(contactId, next)
      return next
    })
    setCreateTagLabel(null)
  }

  async function handleAddNote() {
    const content = newNote.trim()
    if (!content || !primaryProspectId) return
    setAddingNote(true)
    try {
      const res = await fetch(`/api/prospects/${primaryProspectId}/notes`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content }),
      }).then(r => r.json())
      if (res.note) {
        setNotes(prev => [res.note, ...prev])
        setNewNote('')
      }
    } finally {
      setAddingNote(false)
    }
  }

  function handleEditNote(id: string, content: string) {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, content, updated_at: new Date().toISOString() } : n))
  }

  function handleDeleteNote(id: string) {
    setNotes(prev => prev.filter(n => n.id !== id))
  }

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
            {/* Campaigns */}
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
                  <div className="text-xs font-semibold text-[#6b5e4e] mb-2">Campaigns ({campaignAssignments.length})</div>
                  <div className="flex flex-col gap-2">
                    {campaignAssignments.map(a => (
                      <div key={a.id} className="border border-[#f0ece6] rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2.5">
                          <span className="text-xs font-medium text-[#3b6bef] truncate flex-1 mr-2">{a.campaigns?.name ?? '—'}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium flex-shrink-0 ${statusBadgeClass(a.status)}`}>{a.status}</span>
                        </div>
                        <LifecyclePill status={a.status} variant="panel" />
                        {a.added_at && <div className="text-[10px] text-[#b0a898] mt-2">Added {fmtDate(a.added_at)}</div>}
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

            {/* Dates */}
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

            {/* Tags */}
            <div>
              <div className="text-xs font-semibold text-[#6b5e4e] mb-2">Tags</div>
              <div className="relative flex flex-wrap items-center gap-1.5">
                {tags.map(tag => (
                  <Tag
                    key={tag.id}
                    label={tag.label}
                    color={tag.color}
                    onRemove={() => handleRemoveTag(tag.id)}
                  />
                ))}
                {primaryProspectId && (
                  <button
                    onClick={() => setShowTagPicker(true)}
                    className="inline-flex items-center gap-1 text-xs text-[#8a7e6e] hover:text-[#1a1a2e] px-2 py-0.5 rounded-full border border-dashed border-[#d0cbc5] hover:border-[#8a7e6e]"
                  >
                    + Add tag
                  </button>
                )}
                {showTagPicker && primaryProspectId && (
                  <TagPicker
                    workspaceId=""
                    assignedTagIds={tags.map(t => t.id)}
                    onAssign={handleAssignTag}
                    onCreate={label => { setCreateTagLabel(label); setShowTagPicker(false) }}
                    onClose={() => setShowTagPicker(false)}
                  />
                )}
              </div>
            </div>

            {/* Notes */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold text-[#6b5e4e]">Notes</div>
                {notes.length > 0 && (
                  <span className="text-xs text-[#b0a898]">{notes.length}</span>
                )}
              </div>

              <div className="mb-3">
                <textarea
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  placeholder="Add a note…"
                  rows={2}
                  maxLength={5000}
                  className="w-full px-3 py-2 bg-white border border-[#e8e3dc] rounded-lg text-xs resize-none focus:outline-none focus:ring-1 focus:ring-[#3b6bef] focus:border-[#3b6bef]"
                />
                {newNote.trim() && (
                  <div className="flex justify-end gap-2 mt-1.5">
                    <button onClick={() => setNewNote('')}
                      className="text-xs text-[#8a7e6e] hover:text-[#1a1a2e]">Cancel</button>
                    <button onClick={handleAddNote} disabled={addingNote}
                      className="text-xs bg-[#3b6bef] text-white px-3 py-1 rounded-md hover:bg-[#2d5cd9] disabled:opacity-40">
                      {addingNote ? 'Adding…' : 'Add note'}
                    </button>
                  </div>
                )}
              </div>

              {notes.length === 0 ? (
                <div className="text-xs text-[#b0a898] italic">No notes yet.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {notes.map(note => (
                    <NoteItem
                      key={note.id}
                      note={note}
                      isAuthor={note.author_id === currentUserId}
                      onEdit={handleEditNote}
                      onDelete={handleDeleteNote}
                    />
                  ))}
                </div>
              )}
            </div>

            <button onClick={deleteContact} disabled={deleting}
              className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 text-center py-1 transition-colors">
              {deleting ? 'Deleting…' : 'Delete contact & all assignments'}
            </button>
          </div>
        )}
      </div>

      {createTagLabel !== null && primaryProspectId && (
        <CreateTagModal
          initialLabel={createTagLabel}
          prospectId={primaryProspectId}
          onCreated={handleTagCreated}
          onClose={() => setCreateTagLabel(null)}
        />
      )}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function ProspectsPage() {
  const searchParams = useSearchParams()
  const [contacts, setContacts]         = useState<Contact[]>([])
  const [total, setTotal]               = useState(0)
  const [totalAll, setTotalAll]         = useState(0)
  const [filterCounts, setFilterCounts] = useState<Record<string, number>>({})
  const [pages, setPages]               = useState(1)
  const [campaigns, setCampaigns]       = useState<Campaign[]>([])
  const [loading, setLoading]           = useState(true)
  const [page, setPage]                 = useState(1)
  const [search, setSearch]             = useState('')
  const [statusFilters, setStatusFilters] = useState<Set<string>>(() => {
    const p = searchParams.get('filter')
    return p ? new Set(p.split(',').map(s => s.trim()).filter(Boolean)) : new Set()
  })
  const [campaignFilter, setCampaignFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [sort, setSort]                 = useState('newest')
  const [selectedPanel, setSelectedPanel] = useState<string | null>(null)
  const [modal, setModal]               = useState<null | 'csv' | 'manual' | 'paste'>(null)
  const [showExport, setShowExport]     = useState(false)
  const [refreshKey, setRefreshKey]     = useState(0)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [workspaceTags, setWorkspaceTags]   = useState<ProspectTag[]>([])
  const [currentUserId, setCurrentUserId]   = useState<string | null>(null)
  const searchTimeout                   = useRef<ReturnType<typeof setTimeout>>()

  // ── ICP panel ───────────────────────────────────────────────────────────────
  const [icpOpen,     setIcpOpen]     = useState(false)
  const [icpSaving,   setIcpSaving]   = useState(false)
  const [icpSaved,    setIcpSaved]    = useState(false)
  const [wid,         setWid]         = useState<string|null>(null)
  const [fullProfile, setFullProfile] = useState<any>(null)
  const [aiParsing,   setAiParsing]   = useState(false)
  const [icpForm,     setIcpForm]     = useState({
    icp_description:  '',
    industry:         '',
    target_titles:    '',
    target_regions:   '',
    company_sizes:    [] as string[],
    company_revenue:  [] as string[],
    pain_points:      '',
    tone:             'professional',
  })
  const [icpOriginal, setIcpOriginal] = useState(icpForm)

  useEffect(() => {
    fetch('/api/campaigns').then(r => r.json()).then(d => setCampaigns(d.campaigns ?? []))
    fetch('/api/tags').then(r => r.json()).then(d => setWorkspaceTags(d.tags ?? []))
    // Get current user id for note authorship
    fetch('/api/workspace-profile').then(r => r.json()).then(d => {
      if (d.profile?.user_id) setCurrentUserId(d.profile.user_id)
    })
  }, [])

  // Open Master ICP panel when ?openIcp=1 is in the URL
  useEffect(() => {
    if (searchParams.get('openIcp') === '1') {
      setIcpOpen(true)
      setTimeout(() => {
        document.getElementById('master-icp-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
  }, [searchParams])

  // Stable string key from the Set for use in dependency array
  const statusFilterStr = [...statusFilters].sort().join(',')
  const tagFilterStr    = [...selectedTagIds].sort().join(',')

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: '50', sort })
    if (statusFilters.size > 0) params.set('status', statusFilterStr)
    if (campaignFilter !== 'all') params.set('campaign_id', campaignFilter)
    if (sourceFilter !== 'all') params.set('source', sourceFilter)
    if (search) params.set('search', search)
    if (selectedTagIds.length > 0) params.set('tag_ids', tagFilterStr)
    fetch(`/api/contacts?${params}`)
      .then(r => r.json())
      .then(d => {
        setContacts(d.contacts ?? [])
        setTotal(d.total ?? 0)
        setPages(d.pages ?? 1)
        if (d.filter_counts) setFilterCounts(d.filter_counts)
        if (d.total_all !== undefined) setTotalAll(d.total_all)
        setLoading(false)
      })
  }, [page, statusFilterStr, campaignFilter, sourceFilter, sort, tagFilterStr, refreshKey])

  useEffect(() => {
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => { setPage(1); setRefreshKey(k => k + 1) }, 350)
    return () => clearTimeout(searchTimeout.current)
  }, [search])

  useEffect(() => {
    fetch('/api/workspace-profile')
      .then(r => r.json())
      .then(d => {
        const p = d.profile
        if (!p) return
        setWid(p.workspace_id)
        setFullProfile(p)
        const loaded = {
          icp_description:  p.icp_description  || '',
          industry:         p.icp_industries?.[0] || '',
          target_titles:    p.target_titles     || '',
          target_regions:   p.target_regions    || '',
          company_sizes:    p.icp_company_sizes ?? (p.icp_company_size ? [p.icp_company_size] : []),
          company_revenue:  p.target_company_revenue ?? [],
          pain_points:      p.pain_points       || '',
          tone:             p.tone              || 'professional',
        }
        setIcpForm(loaded)
        setIcpOriginal(loaded)
      })
  }, [])

  const profileForScore = fullProfile ? {
    user_industry:          fullProfile.user_industry,
    user_company_size:      fullProfile.user_company_size,
    product_description:    fullProfile.product_description,
    value_proposition:      fullProfile.value_proposition,
    icp_description:        icpForm.icp_description,
    sender_name:            fullProfile.sender_name,
    icp_industries:         icpForm.industry ? [icpForm.industry] : [],
    icp_company_sizes:      icpForm.company_sizes,
    icp_company_size:       icpForm.company_sizes[0] ?? '',
    pain_points:            icpForm.pain_points,
    target_titles:          icpForm.target_titles,
    target_regions:         icpForm.target_regions,
    target_company_revenue: icpForm.company_revenue,
    tone:                   icpForm.tone,
  } : null

  async function saveIcp() {
    if (!wid) return
    setIcpSaving(true)
    await fetch('/api/workspace/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id:           wid,
        icp_description:        icpForm.icp_description,
        icp_industries:         icpForm.industry ? [icpForm.industry] : [],
        target_titles:          icpForm.target_titles,
        target_regions:         icpForm.target_regions,
        icp_company_sizes:      icpForm.company_sizes,
        target_company_revenue: icpForm.company_revenue,
        pain_points:            icpForm.pain_points,
        tone:                   icpForm.tone,
      }),
    })
    setIcpOriginal(icpForm)
    setIcpSaving(false)
    setIcpSaved(true)
    setTimeout(() => setIcpSaved(false), 2000)
  }

  async function handleAiParse() {
    if (!icpForm.icp_description.trim()) return
    setAiParsing(true)
    try {
      const res = await fetch('/api/icp/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: icpForm.icp_description }),
      })
      const data = await res.json()
      if (data.icp) {
        const { icp } = data
        setIcpForm(f => ({
          ...f,
          industry:       icp.industries?.[0]  || f.industry,
          target_titles:  icp.titles?.join(', ') || f.target_titles,
          target_regions: icp.regions?.join(', ') || f.target_regions,
          company_sizes:  icp.company_sizes?.length ? icp.company_sizes.filter((s: string) => COMPANY_SIZES.includes(s)) : f.company_sizes,
          company_revenue: icp.revenue?.length ? icp.revenue.filter((r: string) => REVENUE_RANGES.includes(r)) : f.company_revenue,
          pain_points:    icp.pain_points || f.pain_points,
        }))
      }
    } catch { /* silent fail */ }
    setAiParsing(false)
  }

  function onImported(_res: ImportResult) {
    setRefreshKey(k => k + 1)
    setPage(1)
    setSelectedIds(new Set())
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
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  return (
    <div>
      {/* Profile quality badge */}
      {profileForScore && (
        <ProfileQualityBadge profile={profileForScore} hideEditLink={true} className="mb-4" />
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Prospects</h1>
          <p className="text-sm text-[#8a7e6e]">
            {loading ? 'Loading…' : `${fmt(total)} prospect${total !== 1 ? 's' : ''} across ${campaigns.length} campaign${campaigns.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setIcpOpen(v => !v)}
            className={`border px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${icpOpen ? 'bg-purple-600 text-white border-purple-600' : 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100'}`}>
            🎯 ICP Settings
          </button>
          <button disabled title="AI prospect discovery — Sprint 9"
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
          <button onClick={() => setShowExport(true)}
            className="border border-[#e8e3dc] bg-white text-[#1a1a2e] px-3 py-2 rounded-lg text-sm font-medium hover:bg-[#f5f2ee] flex items-center gap-1.5">
            <span aria-hidden="true">⬇</span> Export
          </button>
          <button onClick={() => setModal('csv')}
            className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
            ⬆ Import CSV
          </button>
        </div>
      </div>

      {/* ── Master ICP Panel ─────────────────────────────────────────────────── */}
      {icpOpen && (
        <div id="master-icp-panel" className="bg-purple-50/50 border border-purple-200 rounded-xl p-6 mb-4">

          {/* Panel header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span>🎯</span>
              <span className="font-semibold text-[#1a1a2e]">Master ICP</span>
              <StatusBadge variant="purple">Source of truth</StatusBadge>
              <Tooltip content={ICP_TOOLTIP}>
                <InfoIcon />
              </Tooltip>
            </div>
            <button onClick={() => setIcpOpen(false)} className="text-[#8a7e6e] hover:text-[#1a1a2e] text-lg leading-none">✕</button>
          </div>
          <p className="text-sm text-[#6b5e4e] mb-5">
            Define your ideal customer once. All new campaigns auto-fill from this.
          </p>

          {/* ICP description — single textarea, scored + AI parse */}
          <div className="bg-white border border-purple-200 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-purple-600 font-medium text-sm">✨ Describe your target ICP in plain English and let AI structure it</span>
            </div>
            <textarea
              value={icpForm.icp_description}
              onChange={e => setIcpForm(f => ({ ...f, icp_description: e.target.value }))}
              rows={4}
              placeholder="e.g. I want to target B2B SaaS founders in Europe who are struggling with outbound sales and have 10-200 employees..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 focus:outline-none focus:border-purple-400 resize-none"
            />
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2">
                <span className={`text-xs ${icpForm.icp_description.length >= 30 ? 'text-green-600' : 'text-[#b0a898]'}`}>
                  {icpForm.icp_description.length}/30 chars{icpForm.icp_description.length >= 30 ? ' ✓' : ''}
                </span>
                <StatusBadge variant="gray">Adds 15% to AI quality</StatusBadge>
              </div>
              <button onClick={handleAiParse} disabled={aiParsing || !icpForm.icp_description.trim()}
                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 transition-colors">
                {aiParsing ? 'Parsing…' : '✨ Parse with AI'}
              </button>
            </div>
          </div>

          {/* Structured ICP */}
          <h3 className="text-blue-600 font-semibold mb-6">Structured ICP</h3>

          {/* Ligne 1 — Industry + Titles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls}>Industry</label>
                <StatusBadge variant="gray">Adds 10% to AI quality</StatusBadge>
              </div>
              <input value={icpForm.industry} onChange={e => setIcpForm(f => ({ ...f, industry: e.target.value }))}
                className={inputCls} placeholder="e.g. SaaS, Fintech" />
              <FieldOk show={!!icpForm.industry} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls}>Titles</label>
                <StatusBadge variant="gray">Adds 10% to AI quality</StatusBadge>
              </div>
              <input value={icpForm.target_titles} onChange={e => setIcpForm(f => ({ ...f, target_titles: e.target.value }))}
                className={inputCls} placeholder="e.g. CEO, CTO, VP Sales" />
              <FieldOk show={!!icpForm.target_titles} />
            </div>
          </div>

          {/* Ligne 2 — Regions + Pain points */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls}>Regions</label>
                <StatusBadge variant="gray">Adds 5% to AI quality</StatusBadge>
              </div>
              <input value={icpForm.target_regions} onChange={e => setIcpForm(f => ({ ...f, target_regions: e.target.value }))}
                className={inputCls} placeholder="e.g. US, Europe, APAC" />
              <FieldOk show={!!icpForm.target_regions} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls}>Pain points</label>
                <StatusBadge variant="gray">Adds 5% to AI quality</StatusBadge>
                <Tooltip content={PAIN_POINTS_TOOLTIP}>
                  <InfoIcon />
                </Tooltip>
              </div>
              <textarea
                value={icpForm.pain_points}
                onChange={e => setIcpForm(f => ({ ...f, pain_points: e.target.value }))}
                rows={3}
                placeholder="e.g. struggling with outbound, missing quota, manual prospecting takes too long..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 focus:outline-none focus:border-purple-400 resize-none"
              />
              <p className={`text-xs mt-1 ${icpForm.pain_points.length >= 20 ? 'text-green-600' : 'text-[#b0a898]'}`}>
                {icpForm.pain_points.length}/20 chars{icpForm.pain_points.length >= 20 ? ' ✓' : ''}
              </p>
            </div>
          </div>

          {/* Ligne 3 — Company size + Company Revenue (grid 2 cols) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className={labelCls}>Company size (select all that apply)</label>
                <StatusBadge variant="gray">Adds 5% to AI quality</StatusBadge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {COMPANY_SIZES.map(s => {
                  const active = icpForm.company_sizes.includes(s)
                  return (
                    <button key={s} type="button"
                      onClick={() => setIcpForm(f => ({ ...f, company_sizes: active ? f.company_sizes.filter(x => x !== s) : [...f.company_sizes, s] }))}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${active ? 'bg-purple-600 text-white border-purple-600' : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-purple-400'}`}>
                      {s}
                    </button>
                  )
                })}
              </div>
              <FieldOk show={icpForm.company_sizes.length > 0} />
            </div>
            <div>
              <label className={`${labelCls} mb-2 block`}>
                Company Revenue <span className="text-[#b0a898] font-normal">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {REVENUE_RANGES.map(r => {
                  const active = icpForm.company_revenue.includes(r)
                  return (
                    <button key={r} type="button"
                      onClick={() => setIcpForm(f => ({ ...f, company_revenue: active ? f.company_revenue.filter(x => x !== r) : [...f.company_revenue, r] }))}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${active ? 'bg-purple-600 text-white border-purple-600' : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-purple-400'}`}>
                      {r}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Tone */}
          <h3 className="text-blue-600 font-semibold mb-4">Tone</h3>
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <label className={labelCls}>Email tone</label>
              <StatusBadge variant="gray">Adds 5% to AI quality</StatusBadge>
            </div>
            <div className="flex flex-wrap gap-2">
              {TONES.map(t => (
                <button key={t} type="button"
                  onClick={() => setIcpForm(f => ({ ...f, tone: t.toLowerCase() }))}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${icpForm.tone === t.toLowerCase() ? 'bg-purple-600 text-white border-purple-600' : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-purple-400'}`}>
                  {t}
                </button>
              ))}
            </div>
            <FieldOk show={!!icpForm.tone} />
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setIcpForm(icpOriginal)}
              className="border border-[#e8e3dc] text-[#6b5e4e] px-4 py-2 rounded-lg text-sm hover:bg-[#f5f2ee] transition-colors">
              Reset
            </button>
            <button onClick={saveIcp} disabled={icpSaving}
              className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors">
              {icpSaved ? '✓ Saved' : icpSaving ? 'Saving…' : 'Save Master ICP'}
            </button>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl p-4 mb-4 flex flex-col gap-3">

        {/* Row 1: search · campaigns · sources · [spacer] · sort */}
        <div className="flex items-center gap-2">
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="flex-1 max-w-2xl border border-[#e8e3dc] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#3b6bef]"
            placeholder="Search by name, email, company…" />
          <select value={campaignFilter} onChange={e => { setCampaignFilter(e.target.value); setPage(1) }}
            className="border border-[#e8e3dc] rounded-lg px-3 py-1.5 text-sm text-[#6b5e4e] focus:outline-none shrink-0">
            <option value="all">Campaigns</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={sourceFilter} onChange={e => { setSourceFilter(e.target.value); setPage(1) }}
            className="border border-[#e8e3dc] rounded-lg px-3 py-1.5 text-sm text-[#6b5e4e] focus:outline-none shrink-0">
            <option value="all">Sources</option>
            <option value="manual">Manual</option>
            <option value="paste">Paste</option>
            <option value="csv_import">CSV</option>
          </select>
          <div className="flex-1" />
          <select value={sort} onChange={e => { setSort(e.target.value); setPage(1) }}
            className="border border-[#e8e3dc] rounded-lg px-3 py-1.5 text-sm text-[#6b5e4e] focus:outline-none shrink-0">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name A–Z</option>
            <option value="name_z">Name Z–A</option>
          </select>
        </div>

        {/* Row 2: status pills · tags */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => { setStatusFilters(new Set()); setPage(1) }}
            className={`text-xs px-3 py-1.5 rounded-lg border capitalize transition-colors flex items-center gap-1 ${statusFilters.size === 0 ? 'bg-[#3b6bef] text-white border-[#3b6bef]' : 'border-[#e8e3dc] text-[#6b5e4e] hover:bg-[#f5f2ee]'}`}>
            All
            <span className={`text-[10px] ${statusFilters.size === 0 ? 'text-white/70' : 'text-[#b0a898]'}`}>{totalAll}</span>
          </button>

          {(['found','emailed','opened','replied','meeting'] as const).map(s => {
            const active = statusFilters.has(s)
            return (
              <button key={s} onClick={() => {
                setStatusFilters(prev => { const n = new Set(prev); active ? n.delete(s) : n.add(s); return n })
                setPage(1)
              }}
                className={`text-xs px-3 py-1.5 rounded-lg border capitalize transition-colors flex items-center gap-1 ${active ? 'bg-[#3b6bef] text-white border-[#3b6bef]' : 'border-[#e8e3dc] text-[#6b5e4e] hover:bg-[#f5f2ee]'}`}>
                {s}
                <span className={`text-[10px] ${active ? 'text-white/70' : 'text-[#b0a898]'}`}>{filterCounts[s] ?? 0}</span>
              </button>
            )
          })}

          <div className="w-px h-4 bg-[#e8e3dc] mx-0.5" />

          {(['bounced','unsubscribed'] as const).map(s => {
            const active = statusFilters.has(s)
            return (
              <button key={s} onClick={() => {
                setStatusFilters(prev => { const n = new Set(prev); active ? n.delete(s) : n.add(s); return n })
                setPage(1)
              }}
                className={`text-xs px-3 py-1.5 rounded-lg border capitalize transition-colors flex items-center gap-1 ${active ? 'bg-red-500 text-white border-red-500' : 'border-[#e8e3dc] text-red-400 hover:bg-red-50'}`}>
                {s}
                <span className={`text-[10px] ${active ? 'text-white/70' : 'text-red-300'}`}>{filterCounts[s] ?? 0}</span>
              </button>
            )
          })}

          <TagFilterDropdown
            availableTags={workspaceTags}
            selectedTagIds={selectedTagIds}
            onChange={ids => { setSelectedTagIds(ids); setPage(1) }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden mb-4">
        <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#f0ece6]">
              <th className="px-4 py-3 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  className="rounded border-[#e8e3dc] text-[#3b6bef] cursor-pointer" />
              </th>
              {['NAME', 'COMPANY', 'EMAIL', 'CAMPAIGNS', 'LIFECYCLE', 'TAGS', 'SOURCE', 'ADDED'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
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
                <td className="px-4 py-3">
                  {c.campaigns_count === 0
                    ? <span className="text-xs text-[#b0a898]">—</span>
                    : <LifecycleCountsCell counts={c.lifecycle_counts} total={c.campaigns_count} />
                  }
                </td>
                <td className="px-4 py-3">
                  {c.tags.length === 0 ? (
                    <span className="text-xs text-[#b0a898]">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1 max-w-[160px]">
                      {c.tags.slice(0, 2).map(t => (
                        <Tag key={t.id} label={t.label} color={t.color} />
                      ))}
                      {c.tags.length > 2 && (
                        <span className="text-[10px] text-[#8a7e6e] self-center">+{c.tags.length - 2}</span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-[#6b5e4e] bg-[#f0ece6] px-2 py-0.5 rounded-full">
                    {SOURCE_LABEL[c.primary_source ?? ''] ?? c.primary_source ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-[#8a7e6e] whitespace-nowrap">{fmtDate(c.added_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
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

      {/* Bulk select sticky bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-50 flex justify-center pb-6 pointer-events-none">
          <div className="pointer-events-auto bg-[#1a1a2e] text-white rounded-2xl shadow-xl px-5 py-3 flex items-center gap-4">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <button onClick={() => setSelectedIds(new Set())}
              className="text-xs text-white/60 hover:text-white/90 transition-colors">Clear</button>
            <button onClick={() => setShowExport(true)}
              className="bg-[#3b6bef] hover:bg-[#2a5adf] text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors">
              <span aria-hidden="true">⬇</span> Export ({selectedIds.size})
            </button>
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
          currentUserId={currentUserId}
          onClose={() => setSelectedPanel(null)}
          onDeleted={() => {
            setSelectedIds(prev => { const n = new Set(prev); n.delete(selectedPanel); return n })
            setRefreshKey(k => k + 1)
          }}
          onContactTagsUpdated={(cid, newTags) => {
            setContacts(prev => prev.map(c => c.id === cid ? { ...c, tags: newTags } : c))
          }}
        />
      )}

      {/* Modals */}
      {modal === 'csv'    && <ImportCSVModal campaigns={campaigns} onClose={() => setModal(null)} onImported={onImported} />}
      {modal === 'manual' && <ManualAddModal campaigns={campaigns} onClose={() => setModal(null)} onImported={onImported} />}
      {modal === 'paste'  && <PasteModal     campaigns={campaigns} onClose={() => setModal(null)} onImported={onImported} />}

      <ExportProspectsModal
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        selectedIds={[...selectedIds]}
        totalCount={totalAll}
        filteredCount={total}
        filters={{
          campaign_id: campaignFilter !== 'all' ? campaignFilter : undefined,
          status:      statusFilters.size > 0 ? [...statusFilters].join(',') : undefined,
          source:      sourceFilter !== 'all' ? sourceFilter : undefined,
          tag_ids:     selectedTagIds.length > 0 ? selectedTagIds : undefined,
          search:      search.trim() || undefined,
        }}
      />
    </div>
  )
}
