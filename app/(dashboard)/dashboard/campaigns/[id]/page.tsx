'use client'
import { useEffect, useState } from 'react'
import { ImportCSVModal, ManualAddModal, statusBadgeClass, type ImportResult } from '@/components/ProspectModals'
import { GenerateDraftsModal } from '@/components/GenerateDraftsModal'
import { EditEmailModal } from '@/components/EditEmailModal'
import { EditFollowUpModal, type FollowUpStep } from '@/components/EditFollowUpModal'

interface Step {
  id: string; step_order: number; step_type: 'initial' | 'follow_up'
  delay_days: number; subject: string | null; body: string; include_booking_link: boolean
}
interface Campaign {
  id: string; name: string; status: string; target_persona: string | null
  angle: string | null; value_prop: string | null; cta: string | null
  prospects_count: number; sent_count: number; opened_count: number
  replied_count: number; meeting_count: number
  smart_stop_on_reply: boolean; smart_stop_on_bounce: boolean
  personalization_mode: 'fast' | 'smart' | null
  include_booking_link_initial: boolean
  drafts_count: number
}
type EmailDraft = {
  id: string; subject: string; body: string
  status: 'draft' | 'edited' | 'approved' | 'sent' | 'rejected'
  mode: 'fast' | 'smart'
  step_order: number | null
  step_type:  string | null
  prospect: {
    id: string; email: string | null
    first_name: string | null; last_name: string | null
    company: string | null; title: string | null
  }
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-[#f0ece6] text-[#6b5e4e]',
  active: 'bg-green-50 text-green-700',
  paused: 'bg-amber-50 text-amber-700',
  completed: 'bg-blue-50 text-blue-700',
  archived: 'bg-gray-100 text-gray-500',
}

const EMAIL_STATUS_BADGE: Record<string, string> = {
  draft:    'bg-[#f0ece6] text-[#6b5e4e]',
  edited:   'bg-amber-50 text-amber-700',
  approved: 'bg-green-50 text-green-700',
  sent:     'bg-blue-50 text-blue-700',
  rejected: 'bg-red-50 text-red-500',
}

export default function CampaignDetailPage({ params }: { params: { id: string } }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [tab, setTab] = useState<'overview' | 'prospects' | 'emails' | 'sequence'>('overview')
  const [loading, setLoading] = useState(true)
  const [generatingStep, setGeneratingStep] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [stopSettings, setStopSettings] = useState({ smart_stop_on_reply: true, smart_stop_on_bounce: true })
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Campaign>>({})
  const [error, setError] = useState('')

  // ── Prospects tab state ────────────────────────────────────────────────────
  type TabProspect = {
    id: string; email: string; status: string; source: string; added_at: string
    contacts: { first_name: string|null; last_name: string|null; company: string|null; title: string|null } | null
  }
  const [tabProspects, setTabProspects]               = useState<TabProspect[]>([])
  const [tabProspectsTotal, setTabProspectsTotal]     = useState(0)
  const [tabProspectsLoading, setTabProspectsLoading] = useState(false)
  const [prospectModal, setProspectModal]             = useState<null | 'csv' | 'manual'>(null)
  const [showRemoveAll, setShowRemoveAll]             = useState(false)
  const [removingAll, setRemovingAll]                 = useState(false)
  const [tabRefreshKey, setTabRefreshKey]             = useState(0)
  const [tabPage, setTabPage]                         = useState(1)
  const [tabPages, setTabPages]                       = useState(1)
  const [selectedProspectIds, setSelectedProspectIds] = useState<Set<string>>(new Set())
  const [bulkDeletingProspects, setBulkDeletingProspects] = useState(false)

  // ── Emails tab state ──────────────────────────────────────────────────────
  const [emailDrafts, setEmailDrafts]               = useState<EmailDraft[]>([])
  const [emailsTotal, setEmailsTotal]               = useState(0)
  const [emailsByStatus, setEmailsByStatus]         = useState<Record<string, number>>({})
  const [emailsLoading, setEmailsLoading]           = useState(false)
  const [emailsFilter, setEmailsFilter]             = useState<string>('all')
  const [emailsPage, setEmailsPage]                 = useState(1)
  const [emailsPages, setEmailsPages]               = useState(1)
  const [emailsRefreshKey, setEmailsRefreshKey]     = useState(0)
  const [selectedEmailIds, setSelectedEmailIds]       = useState<Set<string>>(new Set())
  const [bulkApprovingEmails, setBulkApprovingEmails] = useState(false)
  const [bulkRejectingEmails, setBulkRejectingEmails] = useState(false)
  const [bulkDeletingEmails,  setBulkDeletingEmails]  = useState(false)
  const [showGenerateDraftsModal, setShowGenerateDraftsModal] = useState(false)
  const [generateDraftsIsRegen, setGenerateDraftsIsRegen]     = useState(false)
  const [editEmailId, setEditEmailId]               = useState<string | null>(null)
  const [editFollowUpStep, setEditFollowUpStep]     = useState<Step | null>(null)

  // Eager counts at mount
  useEffect(() => {
    fetch(`/api/prospects?campaign_id=${params.id}&limit=1`)
      .then(r => r.json())
      .then(d => { if (d.total > 0) setTabProspectsTotal(d.total) })
      .catch(() => {})
  }, [params.id])

  useEffect(() => {
    fetch(`/api/prospect-emails?campaign_id=${params.id}&step_order=0&limit=1`)
      .then(r => r.json())
      .then(d => { if (d.total > 0) setEmailsTotal(d.total) })
      .catch(() => {})
  }, [params.id])

  useEffect(() => {
    if (tab !== 'prospects') return
    setTabProspectsLoading(true)
    setTabProspectsTotal(0)
    fetch(`/api/prospects?campaign_id=${params.id}&limit=50&page=${tabPage}&sort=newest`)
      .then(r => r.json())
      .then(d => {
        const prox = d.prospects ?? []
        setTabProspects(prox)
        setTabProspectsTotal(d.total > 0 ? d.total : prox.length)
        setTabPages(d.pages ?? 1)
        setTabProspectsLoading(false)
      })
  }, [tab, params.id, tabRefreshKey, tabPage])

  useEffect(() => {
    if (tab !== 'emails') return
    setEmailsLoading(true)
    const statusParam = emailsFilter !== 'all' ? `&status=${emailsFilter}` : ''
    fetch(`/api/prospect-emails?campaign_id=${params.id}&step_order=0&limit=50&page=${emailsPage}${statusParam}`)
      .then(r => r.json())
      .then(d => {
        setEmailDrafts(d.emails ?? [])
        // by_status is always campaign-wide (unfiltered) — use it as the source of truth
        // so the total never drops to 0 when a status filter returns empty results
        const aggTotal = Object.values(d.by_status ?? {}).reduce((s, n) => s + (n as number), 0)
        setEmailsTotal(aggTotal > 0 ? aggTotal : (d.total ?? 0))
        setEmailsByStatus(d.by_status ?? {})
        setEmailsPages(d.pages ?? 1)
        setEmailsLoading(false)
      })
      .catch(() => setEmailsLoading(false))
  }, [tab, params.id, emailsFilter, emailsPage, emailsRefreshKey])

  function onProspectImported(_res: ImportResult) {
    setTabRefreshKey(k => k + 1)
    setCampaign(prev => prev ? { ...prev, prospects_count: prev.prospects_count + (_res.imported_assignments ?? 0) } : prev)
  }

  async function bulkDeleteProspects() {
    if (selectedProspectIds.size === 0) return
    setBulkDeletingProspects(true)
    await fetch('/api/prospects/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selectedProspectIds] }),
    })
    setBulkDeletingProspects(false)
    setSelectedProspectIds(new Set())
    setTabRefreshKey(k => k + 1)
  }

  async function removeAllProspects() {
    setRemovingAll(true)
    const ids = tabProspects.map(p => p.id)
    if (ids.length > 0) {
      await fetch('/api/prospects/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
    }
    setTabProspects([])
    setTabProspectsTotal(0)
    setRemovingAll(false)
    setShowRemoveAll(false)
    setCampaign(prev => prev ? { ...prev, prospects_count: 0 } : prev)
  }

  async function bulkApproveEmails() {
    if (selectedEmailIds.size === 0) return
    setBulkApprovingEmails(true)
    await fetch('/api/prospect-emails/bulk-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selectedEmailIds] }),
    })
    setBulkApprovingEmails(false)
    setSelectedEmailIds(new Set())
    setEmailsRefreshKey(k => k + 1)
  }

  async function approveEmail(id: string) {
    await fetch(`/api/prospect-emails/${id}/approve`, { method: 'POST' })
    setEmailsRefreshKey(k => k + 1)
  }

  async function rejectEmail(id: string) {
    await fetch(`/api/prospect-emails/${id}/reject`, { method: 'POST' })
    setEmailsRefreshKey(k => k + 1)
  }

  async function bulkRejectEmails() {
    if (selectedEmailIds.size === 0) return
    setBulkRejectingEmails(true)
    await fetch('/api/prospect-emails/bulk-reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selectedEmailIds] }),
    })
    setBulkRejectingEmails(false)
    setSelectedEmailIds(new Set())
    setEmailsRefreshKey(k => k + 1)
  }

  async function bulkDeleteEmails() {
    if (selectedEmailIds.size === 0) return
    setBulkDeletingEmails(true)
    await fetch('/api/prospect-emails/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selectedEmailIds] }),
    })
    setBulkDeletingEmails(false)
    setSelectedEmailIds(new Set())
    setEmailsRefreshKey(k => k + 1)
  }

  useEffect(() => {
    fetch(`/api/campaigns/${params.id}`)
      .then(r => r.json())
      .then(({ campaign: c, steps: s }) => {
        if (c) {
          setCampaign(c)
          setStopSettings({ smart_stop_on_reply: c.smart_stop_on_reply, smart_stop_on_bounce: c.smart_stop_on_bounce })
          // drafts_count is now scoped to step_order=0 in the API
          if (c.drafts_count > 0) setEmailsTotal(c.drafts_count)
        }
        setSteps(s ?? [])
        setLoading(false)
      })
  }, [params.id])

  async function updateStep(id: string, patch: Partial<Step>) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
    await fetch(`/api/campaigns/${params.id}/steps/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
  }

  async function aiWriteStep(id: string) {
    setGeneratingStep(id)
    const res = await fetch(`/api/campaigns/${params.id}/steps/${id}/ai-write`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(r => r.json())
    if (res.step) setSteps(prev => prev.map(s => s.id === id ? { ...s, ...res.step } : s))
    setGeneratingStep(null)
  }

  async function addFollowUp() {
    const res = await fetch(`/api/campaigns/${params.id}/steps`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(r => r.json())
    if (res.step) setSteps(prev => [...prev, res.step])
  }

  async function removeStep(id: string) {
    await fetch(`/api/campaigns/${params.id}/steps/${id}`, { method: 'DELETE' })
    setSteps(prev => prev.filter(s => s.id !== id))
  }

  async function patchStopSetting(patch: Partial<typeof stopSettings>) {
    setStopSettings(s => ({ ...s, ...patch }))
    await fetch(`/api/campaigns/${params.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  }

  async function saveCampaignEdit() {
    setSaving(true)
    const res = await fetch(`/api/campaigns/${params.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm),
    }).then(r => r.json())
    if (res.campaign) setCampaign(res.campaign)
    setEditMode(false)
    setSaving(false)
  }

  if (loading) return <div className="text-sm text-[#8a7e6e] py-10 text-center">Loading…</div>
  if (!campaign) return <div className="text-sm text-red-500 py-10 text-center">Campaign not found.</div>

  const statusLabel      = campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)
  const followUpSteps = steps.filter(s => s.step_order >= 1)

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <a href="/dashboard/campaigns" className="text-xs text-[#8a7e6e] hover:text-[#1a1a2e] mb-2 inline-block">← Back to campaigns</a>
          <h1 className="text-2xl font-bold text-[#1a1a2e] leading-tight">{campaign.name}</h1>
          <p className="text-sm text-[#8a7e6e] mt-0.5">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold mr-2 ${STATUS_COLORS[campaign.status] ?? 'bg-gray-100 text-gray-500'}`}>{statusLabel}</span>
            {campaign.prospects_count} prospects · {campaign.sent_count} sent
          </p>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-lg mt-3 mb-2">{error}</div>}

      {/* Tabs */}
      <div className="flex gap-1 my-5 p-1 bg-[#f0ece6] rounded-xl w-fit">
        {([
          { key: 'overview',  label: 'Overview' },
          { key: 'prospects', label: `Prospects (${tabProspectsTotal})` },
          { key: 'emails',    label: `Emails (${emailsTotal})` },
          { key: 'sequence',  label: `Follow-up Sequence (${followUpSteps.length})` },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${tab === t.key ? 'bg-white shadow-sm text-[#1a1a2e]' : 'text-[#8a7e6e] hover:text-[#4a4a5a]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Overview ────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-xl px-4 py-3 text-sm text-[#3b6bef] flex items-center gap-2">
            <span>🚀</span>
            <span>Sending and scheduling will be available soon. For now, you can review and approve all your drafts.</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: 'Prospects', value: campaign.prospects_count },
              { label: 'Sent',      value: campaign.sent_count },
              { label: 'Opened',    value: campaign.opened_count },
              { label: 'Replied',   value: campaign.replied_count },
              { label: 'Meetings',  value: campaign.meeting_count },
            ].map(s => (
              <div key={s.label} className="bg-white border border-[#e8e3dc] rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-[#1a1a2e]">{s.value}</div>
                <div className="text-xs text-[#8a7e6e] uppercase tracking-wider mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          {!editMode ? (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider">Campaign Info</div>
                <button onClick={() => { setEditForm({ name: campaign.name, target_persona: campaign.target_persona ?? '', angle: campaign.angle ?? '', value_prop: campaign.value_prop ?? '', cta: campaign.cta ?? '' }); setEditMode(true) }}
                  className="text-xs text-[#3b6bef] font-medium hover:underline">Edit campaign</button>
              </div>
              <div className="flex flex-col gap-3 text-sm">
                {[
                  { label: 'Target persona', value: campaign.target_persona },
                  { label: 'Angle', value: campaign.angle },
                  { label: 'Value proposition', value: campaign.value_prop },
                  { label: 'CTA', value: campaign.cta },
                ].map(f => f.value && (
                  <div key={f.label}>
                    <div className="text-xs font-semibold text-[#6b5e4e] mb-0.5">{f.label}</div>
                    <div className="text-[#4a4a5a] leading-relaxed">{f.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 flex flex-col gap-3">
              <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-1">Edit Campaign</div>
              {[
                { key: 'name', label: 'Name', rows: 1 },
                { key: 'target_persona', label: 'Target persona', rows: 2 },
                { key: 'angle', label: 'Angle', rows: 2 },
                { key: 'value_prop', label: 'Value proposition', rows: 2 },
                { key: 'cta', label: 'CTA', rows: 1 },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">{f.label}</label>
                  {f.rows === 1
                    ? <input value={(editForm as any)[f.key] ?? ''} onChange={e => setEditForm({ ...editForm, [f.key]: e.target.value })} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
                    : <textarea value={(editForm as any)[f.key] ?? ''} onChange={e => setEditForm({ ...editForm, [f.key]: e.target.value })} rows={f.rows} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" />
                  }
                </div>
              ))}
              <div className="flex gap-2 mt-1">
                <button onClick={() => setEditMode(false)} className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm">Cancel</button>
                <button onClick={saveCampaignEdit} disabled={saving} className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Prospects ───────────────────────────────────────────────────── */}
      {tab === 'prospects' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-sm text-[#8a7e6e]">
              {tabProspectsLoading ? 'Loading…' : `${tabProspectsTotal.toLocaleString()} prospect${tabProspectsTotal !== 1 ? 's' : ''}`}
            </span>
            <div className="flex gap-2">
              {tabProspects.length > 0 && (
                <button onClick={() => setShowRemoveAll(true)}
                  className="border border-red-200 text-red-500 hover:bg-red-50 px-3 py-2 rounded-lg text-sm font-medium">
                  Remove All
                </button>
              )}
              <button onClick={() => setProspectModal('manual')}
                className="border border-[#e8e3dc] bg-white text-[#1a1a2e] px-3 py-2 rounded-lg text-sm font-medium hover:bg-[#f5f2ee]">
                Add manually
              </button>
              <button onClick={() => setProspectModal('csv')}
                className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
                ⬆ Import CSV
              </button>
            </div>
          </div>

          <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#f0ece6]">
                  <th className="px-4 py-3 w-8">
                    <input type="checkbox"
                      checked={tabProspects.length > 0 && tabProspects.every(p => selectedProspectIds.has(p.id))}
                      onChange={() => {
                        const allSel = tabProspects.every(p => selectedProspectIds.has(p.id))
                        setSelectedProspectIds(prev => {
                          const n = new Set(prev)
                          tabProspects.forEach(p => allSel ? n.delete(p.id) : n.add(p.id))
                          return n
                        })
                      }}
                      className="rounded border-[#e8e3dc] text-[#3b6bef] cursor-pointer" />
                  </th>
                  {['NAME', 'EMAIL', 'STATUS', 'SOURCE', 'ADDED'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tabProspectsLoading ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-[#8a7e6e]">Loading…</td></tr>
                ) : tabProspects.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center">
                    <div className="text-2xl mb-2">📋</div>
                    <div className="text-sm font-semibold text-[#1a1a2e] mb-1">No prospects yet</div>
                    <div className="text-xs text-[#8a7e6e]">Add prospects to start your campaign.</div>
                  </td></tr>
                ) : tabProspects.map(p => (
                  <tr key={p.id} className={`border-b border-[#f7f4f0] hover:bg-[#faf8f5] ${selectedProspectIds.has(p.id) ? 'bg-[#f5f7ff]' : ''}`}>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedProspectIds.has(p.id)}
                        onChange={() => setSelectedProspectIds(prev => {
                          const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n
                        })}
                        className="rounded border-[#e8e3dc] text-[#3b6bef] cursor-pointer" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-[#1a1a2e]">
                        {[p.contacts?.first_name, p.contacts?.last_name].filter(Boolean).join(' ') || <span className="text-[#b0a898]">—</span>}
                      </div>
                      {p.contacts?.company && <div className="text-xs text-[#8a7e6e]">{p.contacts.company}</div>}
                    </td>
                    <td className="px-4 py-3 text-sm text-[#8a7e6e]">{p.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${statusBadgeClass(p.status)}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-[#6b5e4e] bg-[#f0ece6] px-2 py-0.5 rounded-full">
                        {{ manual: 'Manual', paste: 'Paste', csv_import: 'CSV', ai_discover: 'AI' }[p.source] ?? p.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#8a7e6e]">
                      {p.added_at ? new Date(p.added_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {tabPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setTabPage(p => Math.max(1, p - 1))} disabled={tabPage === 1}
                className="border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-sm text-[#6b5e4e] disabled:opacity-40">← Prev</button>
              <span className="text-sm text-[#8a7e6e]">{tabPage} / {tabPages}</span>
              <button onClick={() => setTabPage(p => Math.min(tabPages, p + 1))} disabled={tabPage === tabPages}
                className="border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-sm text-[#6b5e4e] disabled:opacity-40">Next →</button>
            </div>
          )}

          {selectedProspectIds.size > 0 && (
            <div className="fixed bottom-0 inset-x-0 z-50 flex justify-center pb-6 pointer-events-none">
              <div className="pointer-events-auto bg-[#1a1a2e] text-white rounded-2xl shadow-xl px-5 py-3 flex items-center gap-4">
                <span className="text-sm font-medium">{selectedProspectIds.size} selected</span>
                <button onClick={() => setSelectedProspectIds(new Set())}
                  className="text-xs text-white/60 hover:text-white/90 transition-colors">Clear</button>
                <button onClick={bulkDeleteProspects} disabled={bulkDeletingProspects}
                  className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-1.5 rounded-lg disabled:opacity-40 transition-colors">
                  {bulkDeletingProspects ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
          )}

          {showRemoveAll && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
                <h2 className="text-base font-bold text-[#1a1a2e] mb-2">Remove all prospects?</h2>
                <p className="text-sm text-[#6b5e4e] mb-5">
                  This will permanently delete all {tabProspectsTotal.toLocaleString()} prospects from this campaign. This cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setShowRemoveAll(false)}
                    className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm">Cancel</button>
                  <button onClick={removeAllProspects} disabled={removingAll}
                    className="flex-1 bg-red-500 text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40">
                    {removingAll ? 'Removing…' : 'Remove All'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {prospectModal === 'csv'    && <ImportCSVModal campaignId={params.id} campaignName={campaign?.name} onClose={() => setProspectModal(null)} onImported={onProspectImported} />}
          {prospectModal === 'manual' && <ManualAddModal campaignId={params.id} onClose={() => setProspectModal(null)} onImported={onProspectImported} />}
        </div>
      )}

      {/* ── Tab: Emails ──────────────────────────────────────────────────────── */}
      {tab === 'emails' && (
        <div className="flex flex-col gap-4">

          {/* Empty: no prospects */}
          {!emailsLoading && tabProspectsTotal === 0 && emailsTotal === 0 && (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-10 text-center">
              <div className="text-3xl mb-3">👥</div>
              <h2 className="text-base font-bold text-[#1a1a2e] mb-2">Add prospects first</h2>
              <p className="text-sm text-[#8a7e6e] mb-4">Import your prospect list before generating emails.</p>
              <button onClick={() => setTab('prospects')}
                className="bg-[#3b6bef] text-white px-5 py-2 rounded-lg text-sm font-semibold">
                Go to Prospects
              </button>
            </div>
          )}

          {/* Empty: has prospects, no drafts yet */}
          {!emailsLoading && tabProspectsTotal > 0 && emailsTotal === 0 && (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-10 text-center">
              <div className="text-3xl mb-3">✉️</div>
              <h2 className="text-base font-bold text-[#1a1a2e] mb-2">No drafts yet</h2>
              <p className="text-sm text-[#8a7e6e] mb-4">
                Generate personalized emails for the {tabProspectsTotal} prospect{tabProspectsTotal !== 1 ? 's' : ''} in this campaign.
              </p>
              <button onClick={() => { setGenerateDraftsIsRegen(false); setShowGenerateDraftsModal(true) }}
                className="bg-[#3b6bef] text-white px-5 py-2 rounded-lg text-sm font-semibold">
                ✨ Generate Drafts
              </button>
            </div>
          )}

          {/* Populated */}
          {emailsTotal > 0 && (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  {(['all', 'draft', 'edited', 'approved', 'rejected'] as const).map(f => {
                    const count = f === 'all' ? emailsTotal : (emailsByStatus[f] ?? 0)
                    return (
                      <button key={f} onClick={() => { setEmailsFilter(f); setEmailsPage(1) }}
                        className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors capitalize ${
                          emailsFilter === f
                            ? 'bg-[#1a1a2e] text-white'
                            : 'bg-[#f0ece6] text-[#6b5e4e] hover:bg-[#e8e3dc]'
                        }`}>
                        {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)} ({count})
                      </button>
                    )
                  })}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setGenerateDraftsIsRegen(true); setShowGenerateDraftsModal(true) }}
                    className="border border-[#e8e3dc] text-[#6b5e4e] px-3 py-2 rounded-lg text-sm hover:bg-[#f5f2ee]">
                    ↺ Regenerate all
                  </button>
                  <button onClick={() => { setGenerateDraftsIsRegen(false); setShowGenerateDraftsModal(true) }}
                    className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold">
                    + Generate more
                  </button>
                  <button disabled title="Coming soon"
                    className="border border-[#e8e3dc] text-[#b0a898] px-3 py-2 rounded-lg text-sm cursor-not-allowed flex items-center gap-1.5">
                    📅 Schedule
                    <span className="text-[9px] bg-[#e8e3dc] text-[#8a7e6e] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide">Soon</span>
                  </button>
                  <button disabled title="Coming soon"
                    className="border border-[#e8e3dc] text-[#b0a898] px-3 py-2 rounded-lg text-sm cursor-not-allowed flex items-center gap-1.5">
                    Send All
                    <span className="text-[9px] bg-[#e8e3dc] text-[#8a7e6e] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide">Soon</span>
                  </button>
                </div>
              </div>

              {emailsLoading ? (
                <div className="text-sm text-[#8a7e6e] py-10 text-center">Loading…</div>
              ) : emailDrafts.length === 0 ? (
                <div className="bg-white border border-[#e8e3dc] rounded-xl p-8 text-center text-sm text-[#8a7e6e]">
                  No emails match this filter.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {emailDrafts.map(email => {
                    const contactName = [email.prospect.first_name, email.prospect.last_name]
                      .filter(Boolean).join(' ') || email.prospect.email || '—'
                    const bodyPreview = email.body.replace(/\n+/g, ' ').slice(0, 100)
                    const isApproved = email.status === 'approved' || email.status === 'sent'
                    const isRejected = email.status === 'rejected'

                    return (
                      <div key={email.id}
                        className={`bg-white border rounded-xl px-4 py-3 transition-colors ${
                          selectedEmailIds.has(email.id) ? 'border-[#3b6bef] bg-[#f5f7ff]' : 'border-[#e8e3dc]'
                        }`}>
                        <div className="flex items-center gap-3">
                          {/* Checkbox */}
                          <input type="checkbox"
                            checked={selectedEmailIds.has(email.id)}
                            onChange={() => setSelectedEmailIds(prev => {
                              const n = new Set(prev); n.has(email.id) ? n.delete(email.id) : n.add(email.id); return n
                            })}
                            className="rounded border-[#e8e3dc] text-[#3b6bef] cursor-pointer shrink-0" />

                          {/* Prospect info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                              <span className="text-sm font-semibold text-[#1a1a2e] truncate">{contactName}</span>
                              {email.prospect.company && (
                                <span className="text-xs text-[#8a7e6e] truncate">· {email.prospect.company}</span>
                              )}
                            </div>
                            <div className="text-xs font-semibold text-[#1a1a2e] truncate">
                              {email.subject || <span className="italic font-normal text-[#b0a898]">(no subject)</span>}
                            </div>
                            <div className="text-xs text-[#8a7e6e] truncate mt-0.5">{bodyPreview}…</div>
                          </div>

                          {/* State badge — read-only */}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize shrink-0 ${EMAIL_STATUS_BADGE[email.status] ?? 'bg-gray-100 text-gray-500'}`}>
                            {email.status}
                          </span>

                          {/* Action buttons */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => setEditEmailId(email.id)}
                              className="text-xs text-[#3b6bef] border border-[#dde6fd] bg-[#f7f8ff] hover:bg-[#eef1fd] px-2 py-1 rounded-lg font-medium transition-colors">
                              Edit
                            </button>
                            {isRejected ? (
                              <button disabled
                                className="text-xs text-red-400 border border-red-100 bg-red-50 px-2 py-1 rounded-lg font-medium cursor-not-allowed opacity-70">
                                Rejected ✓
                              </button>
                            ) : (
                              <button
                                onClick={() => rejectEmail(email.id)}
                                className="text-xs text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg font-medium transition-colors">
                                Reject
                              </button>
                            )}
                            {isApproved ? (
                              <button disabled
                                className="text-xs text-green-600 border border-green-200 bg-green-50 px-2 py-1 rounded-lg font-medium cursor-not-allowed opacity-70">
                                Approved ✓
                              </button>
                            ) : (
                              <button
                                onClick={() => approveEmail(email.id)}
                                className="text-xs text-green-700 border border-green-200 bg-green-50 hover:bg-green-100 px-2 py-1 rounded-lg font-medium transition-colors">
                                Approve
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {emailsPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <button onClick={() => setEmailsPage(p => Math.max(1, p - 1))} disabled={emailsPage === 1}
                    className="border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-sm text-[#6b5e4e] disabled:opacity-40">← Prev</button>
                  <span className="text-sm text-[#8a7e6e]">{emailsPage} / {emailsPages}</span>
                  <button onClick={() => setEmailsPage(p => Math.min(emailsPages, p + 1))} disabled={emailsPage === emailsPages}
                    className="border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-sm text-[#6b5e4e] disabled:opacity-40">Next →</button>
                </div>
              )}
            </>
          )}

          {/* Bulk sticky bar */}
          {selectedEmailIds.size > 0 && (
            <div className="fixed bottom-0 inset-x-0 z-50 flex justify-center pb-6 pointer-events-none">
              <div className="pointer-events-auto bg-[#1a1a2e] text-white rounded-2xl shadow-xl px-5 py-3 flex items-center gap-3">
                <span className="text-sm font-medium">{selectedEmailIds.size} selected</span>
                <button onClick={() => setSelectedEmailIds(new Set())}
                  className="text-xs text-white/60 hover:text-white/90 transition-colors">Clear</button>
                <button onClick={bulkApproveEmails} disabled={bulkApprovingEmails}
                  className="bg-green-500 hover:bg-green-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40 transition-colors">
                  {bulkApprovingEmails ? 'Approving…' : 'Approve all'}
                </button>
                <button onClick={bulkRejectEmails} disabled={bulkRejectingEmails}
                  className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40 transition-colors">
                  {bulkRejectingEmails ? 'Rejecting…' : 'Reject all'}
                </button>
                <button onClick={bulkDeleteEmails} disabled={bulkDeletingEmails}
                  className="border border-white/20 text-white/80 hover:text-white text-sm px-3 py-1.5 rounded-lg disabled:opacity-40 transition-colors">
                  {bulkDeletingEmails ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          )}

          {/* Generate/Regenerate modal */}
          {showGenerateDraftsModal && (
            <GenerateDraftsModal
              campaignId={params.id}
              prospectCount={tabProspectsTotal}
              defaultMode={campaign.personalization_mode ?? undefined}
              includeBookingLink={campaign.include_booking_link_initial ?? false}
              isRegenerate={generateDraftsIsRegen}
              onClose={() => setShowGenerateDraftsModal(false)}
              onGenerated={() => {
                setShowGenerateDraftsModal(false)
                setEmailsRefreshKey(k => k + 1)
              }}
            />
          )}

          {/* Edit draft modal */}
          {editEmailId && (
            <EditEmailModal
              emailId={editEmailId}
              campaignPersonalizationMode={campaign.personalization_mode}
              onClose={() => setEditEmailId(null)}
              onSaved={() => {
                setEditEmailId(null)
                setEmailsRefreshKey(k => k + 1)
              }}
            />
          )}

        </div>
      )}

      {/* ── Tab: Follow-up Sequence ──────────────────────────────────────────── */}
      {tab === 'sequence' && (
        <div className="flex flex-col gap-4">
          <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-xl px-4 py-2.5 text-sm text-[#3b6bef] font-medium flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full inline-block ${campaign.status === 'active' ? 'bg-green-400' : 'bg-amber-400'}`} />
            {campaign.status} · {followUpSteps.length} follow-up{followUpSteps.length !== 1 ? 's' : ''}
          </div>

          {followUpSteps.length === 0 ? (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-10 text-center">
              <div className="text-3xl mb-3">↩️</div>
              <h2 className="text-base font-bold text-[#1a1a2e] mb-2">No follow-ups yet</h2>
              <p className="text-sm text-[#8a7e6e] mb-4">Add follow-ups to re-engage prospects who didn't reply.</p>
              <button onClick={addFollowUp}
                className="bg-[#3b6bef] text-white px-5 py-2.5 rounded-lg text-sm font-semibold">
                + Add first follow-up
              </button>
            </div>
          ) : (
            <>
              {followUpSteps.map((step, idx) => (
                <FollowUpCard
                  key={step.id}
                  step={step}
                  followUpNumber={idx + 1}
                  isOnly={followUpSteps.length <= 1}
                  saving={generatingStep === step.id}
                  onBookingToggle={v => updateStep(step.id, { include_booking_link: v })}
                  onAiWrite={() => aiWriteStep(step.id)}
                  onEdit={() => setEditFollowUpStep(step)}
                  onRemove={() => removeStep(step.id)}
                />
              ))}

              <button onClick={addFollowUp}
                className="w-full border border-dashed border-[#c8d4e8] text-[#3b6bef] text-sm py-3 rounded-xl hover:bg-[#f7f8ff] transition-colors font-medium">
                + Add follow-up step
              </button>

              <div className="bg-white border border-[#e8e3dc] rounded-xl p-4">
                <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-3">Smart Stop Conditions</div>
                <div className="flex flex-col gap-2">
                  <Toggle label="Stop sequence when prospect replies" checked={stopSettings.smart_stop_on_reply}
                    onChange={v => patchStopSetting({ smart_stop_on_reply: v })} />
                  <Toggle label="Stop sequence on hard bounce" checked={stopSettings.smart_stop_on_bounce}
                    onChange={v => patchStopSetting({ smart_stop_on_bounce: v })} />
                </div>
              </div>

              <div className="flex gap-3">
                <button disabled
                  className="border border-[#e8e3dc] text-[#b0a898] rounded-lg px-4 py-2.5 text-sm cursor-not-allowed flex items-center gap-2">
                  Save as Template
                  <span className="text-[9px] bg-[#e8e3dc] text-[#8a7e6e] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide">
                    Coming soon
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Edit follow-up modal — top-level so it works from any tab */}
      {editFollowUpStep && (
        <EditFollowUpModal
          step={editFollowUpStep}
          followUpNumber={followUpSteps.findIndex(s => s.id === editFollowUpStep.id) + 1}
          campaignId={params.id}
          onClose={() => setEditFollowUpStep(null)}
          onSaved={updated => {
            setSteps(prev => prev.map(s => s.id === updated.id ? { ...s, ...updated } : s))
            setEditFollowUpStep(null)
          }}
        />
      )}
    </div>
  )
}

function FollowUpCard({ step, followUpNumber, isOnly, saving, onBookingToggle, onAiWrite, onEdit, onRemove }: {
  step: Step; followUpNumber: number; isOnly: boolean; saving: boolean
  onBookingToggle: (v: boolean) => void; onAiWrite: () => void; onEdit: () => void; onRemove: () => void
}) {
  const subjectPreview = step.subject || null
  const bodyPreview    = step.body.replace(/\n+/g, ' ').slice(0, 120)

  return (
    <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
      {/* Card header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-[#3b6bef] text-white text-xs flex items-center justify-center font-bold flex-shrink-0">
            {followUpNumber}
          </div>
          <span className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider">
            Follow-up #{followUpNumber}
          </span>
        </div>
        <span className="text-xs font-medium text-[#8a7e6e] bg-[#f0ece6] px-2 py-0.5 rounded-full">
          Day +{step.delay_days}
        </span>
      </div>

      {/* Preview */}
      <div className="mb-3 text-sm">
        <div className="font-semibold text-[#1a1a2e] truncate mb-0.5">
          {subjectPreview ?? <span className="italic font-normal text-[#b0a898]">(no subject — thread reply)</span>}
        </div>
        <div className="text-xs text-[#8a7e6e] truncate">
          {bodyPreview ? `${bodyPreview}…` : <span className="italic">(empty body)</span>}
        </div>
      </div>

      {/* Booking link toggle */}
      <label className="flex items-center gap-2 cursor-pointer mb-4">
        <input type="checkbox" checked={step.include_booking_link}
          onChange={e => onBookingToggle(e.target.checked)}
          className="rounded border-[#e8e3dc] text-[#3b6bef]" />
        <span className="text-xs text-[#6b5e4e]">📅 Include calendar booking link in this follow-up</span>
      </label>

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-2">
        <button onClick={onAiWrite} disabled={saving}
          className="text-xs text-[#3b6bef] font-medium border border-[#dde6fd] bg-[#f7f8ff] px-2.5 py-1.5 rounded-lg hover:bg-[#eef1fd] disabled:opacity-40 flex items-center gap-1 shrink-0 transition-colors">
          {saving
            ? <span className="w-3 h-3 border border-[#3b6bef]/30 border-t-[#3b6bef] rounded-full animate-spin" />
            : '✨'} AI Write
        </button>
        <div className="flex items-center gap-2">
          <button onClick={onEdit}
            className="text-xs text-[#3b6bef] border border-[#dde6fd] bg-[#f7f8ff] hover:bg-[#eef1fd] px-2.5 py-1.5 rounded-lg font-medium transition-colors">
            Edit
          </button>
          {!isOnly && (
            <button onClick={onRemove}
              className="text-xs text-red-400 hover:text-red-600 font-medium border border-red-100 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors">
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[#4a4a5a]">{label}</span>
      <button onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-[#3b6bef]' : 'bg-[#e8e3dc]'}`}>
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )
}
