'use client'
import { use, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { useOnboardingProgress } from '@/lib/hooks/useOnboardingProgress'
import { Tooltip } from '@/components/Tooltip'
import { ImportCSVModal, ManualAddModal, statusBadgeClass, type ImportResult } from '@/components/ProspectModals'
import { AddFromBaseModal } from '@/components/AddFromBaseModal'
import { ProspectSignalsDrawer } from './_components/ProspectSignalsDrawer'
import { ApprovalQueueClient } from './_components/ApprovalQueueClient'
import { GenerateDraftsModal } from '@/components/GenerateDraftsModal'
import { EditEmailModal } from '@/components/EditEmailModal'
import { EditFollowupModal } from '@/components/EditFollowUpModal'
import { CampaignProspectMobileCard } from './_components/CampaignProspectMobileCard'

interface Step {
  id: string; step_order: number; step_type: 'initial' | 'follow_up'
  delay_days: number; subject: string | null; body: string; include_booking_link: boolean
}
interface Campaign {
  id: string; name: string; status: string; target_persona: string | null
  angle: string | null; value_prop: string | null; cta: string | null
  proof_points: string | null
  prospects_count: number; sent_count: number; opened_count: number
  replied_count: number; meeting_count: number
  smart_stop_on_reply: boolean; smart_stop_on_bounce: boolean
  personalization_mode: 'fast' | 'smart' | null
  include_booking_link_initial: boolean
  drafts_count: number
  pending_drafts_count: number
}

const PROOF_MAX = 500

type EmailDraft = {
  id: string; subject: string; body: string
  status: 'draft' | 'edited' | 'approved' | 'sending' | 'sent' | 'failed' | 'bounced' | 'replied' | 'rejected'
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

// Values only. Labels resolved at render via useTranslations().
// campaigns.list.statuses.* is REUSED for campaign.status pill (Lot 2A.4.1).
const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed', 'archived'] as const

// EmailStatusBadge dynamic keys — declared under dashboard.campaigns.detail.emailStatuses.*
const EMAIL_STATUS_STYLES: Record<string, string> = {
  draft:    'bg-gray-100 text-gray-700',
  edited:   'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  sent:     'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-700',
}
const EMAIL_STATUS_KEYS = ['draft', 'edited', 'approved', 'sent', 'rejected'] as const

// Prospects table Source column dynamic keys — under dashboard.campaigns.detail.sources.*
const SOURCE_KEYS = ['manual', 'paste', 'csv_import', 'ai_discover'] as const

function EmailStatusBadge({ status }: { status: string }) {
  const t = useTranslations('dashboard.campaigns.detail.emailStatuses')
  const cls = EMAIL_STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-500'
  const label = (EMAIL_STATUS_KEYS as readonly string[]).includes(status) ? t(status) : status
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${cls}`}>{label}</span>
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations('dashboard.campaigns.detail')
  const tHeader = useTranslations('dashboard.campaigns.detail.header')
  const tTabs = useTranslations('dashboard.campaigns.detail.tabs')
  const tOverview = useTranslations('dashboard.campaigns.detail.overview')
  const tNextStep = useTranslations('dashboard.campaigns.detail.overview.nextStep')
  const tKpis = useTranslations('dashboard.campaigns.detail.overview.kpis')
  const tInfo = useTranslations('dashboard.campaigns.detail.overview.info')
  const tFields = useTranslations('dashboard.campaigns.detail.overview.fields')
  const tEditForm = useTranslations('dashboard.campaigns.detail.overview.editForm')
  const tProspects = useTranslations('dashboard.campaigns.detail.prospects')
  const tAddFromBase = useTranslations('components.addFromBaseModal')
  const tProspectsCols = useTranslations('dashboard.campaigns.detail.prospects.columns')
  const tEmails = useTranslations('dashboard.campaigns.detail.emails')
  const tEmailStatuses = useTranslations('dashboard.campaigns.detail.emailStatuses')
  const tSources = useTranslations('dashboard.campaigns.detail.sources')
  const tPagination = useTranslations('dashboard.campaigns.detail.pagination')
  const tToasts = useTranslations('dashboard.campaigns.detail.toasts')
  const tCampaignStatuses = useTranslations('dashboard.campaigns.list.statuses')  // REUSE Lot 2A.4.1
  const tCommon = useTranslations('dashboard.common')
  const tIcpGate = useTranslations('dashboard.campaigns.icpGate')

  const { id } = use(params)
  const router = useRouter()
  const { data: onboarding } = useOnboardingProgress()
  const icpConfigured = onboarding?.completions.icp_configured === true

  function openGenerateDraftsModal(isRegen: boolean) {
    if (!icpConfigured) {
      toast.error(tIcpGate('toastTitle'), {
        description: tIcpGate('toastDescription'),
        action: {
          label:   tIcpGate('toastCta'),
          onClick: () => { window.location.href = '/dashboard/profile#icp' },
        },
      })
      return
    }
    setGenerateDraftsIsRegen(isRegen)
    setShowGenerateDraftsModal(true)
  }
  const searchParams = useSearchParams()
  // Warmup capacity toast is shown at most once per browser session to avoid
  // spamming users who bulk-approve. Ref-based (not localStorage) — an
  // intentional refresh resets it, which matches the "session" semantic
  // used elsewhere in this repo.
  const warmupToastShownRef = useRef(false)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [tab, setTab] = useState<'overview' | 'prospects' | 'emails' | 'sequence' | 'approval_queue'>(() => {
    const t = searchParams.get('tab')
    return t === 'prospects' || t === 'emails' || t === 'sequence' || t === 'approval_queue' ? t : 'overview'
  })
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
    prospect_signals: [{ count: number }] | null
  }
  const [tabProspects, setTabProspects]               = useState<TabProspect[]>([])
  const [tabProspectsTotal, setTabProspectsTotal]     = useState(0)
  const [tabProspectsLoading, setTabProspectsLoading] = useState(false)
  const [prospectModal, setProspectModal]             = useState<null | 'csv' | 'manual' | 'base'>(null)
  const [showRemoveAll, setShowRemoveAll]             = useState(false)
  const [removingAll, setRemovingAll]                 = useState(false)
  const [tabRefreshKey, setTabRefreshKey]             = useState(0)
  const [tabPage, setTabPage]                         = useState(1)
  const [tabPages, setTabPages]                       = useState(1)
  const [drawerProspect, setDrawerProspect]           = useState<{ id: string; email: string; name?: string } | null>(null)
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
  const [generatingMissing, setGeneratingMissing]             = useState(false)
  const [emailActionError, setEmailActionError]               = useState('')
  const [editEmailId,    setEditEmailId]    = useState<string | null>(null)
  const [editingStep,    setEditingStep]    = useState<Step | null>(null)

  // Eager counts at mount
  useEffect(() => {
    fetch(`/api/prospects?campaign_id=${id}&limit=1`)
      .then(r => r.json())
      .then(d => { if (d.total > 0) setTabProspectsTotal(d.total) })
      .catch(() => {})
  }, [id])

  useEffect(() => {
    fetch(`/api/prospect-emails?campaign_id=${id}&step_order=0&limit=1`)
      .then(r => r.json())
      .then(d => { if (d.total > 0) setEmailsTotal(d.total) })
      .catch(() => {})
  }, [id])

  useEffect(() => {
    if (tab !== 'prospects') return
    setTabProspectsLoading(true)
    setTabProspectsTotal(0)
    fetch(`/api/prospects?campaign_id=${id}&limit=50&page=${tabPage}&sort=newest`)
      .then(r => r.json())
      .then(d => {
        const prox = d.prospects ?? []
        setTabProspects(prox)
        setTabProspectsTotal(d.total > 0 ? d.total : prox.length)
        setTabPages(d.pages ?? 1)
        setTabProspectsLoading(false)
      })
  }, [tab, id, tabRefreshKey, tabPage])

  useEffect(() => {
    if (tab !== 'emails') return
    setEmailsLoading(true)
    const statusParam = emailsFilter !== 'all' ? `&status=${emailsFilter}` : ''
    fetch(`/api/prospect-emails?campaign_id=${id}&step_order=0&limit=50&page=${emailsPage}${statusParam}`)
      .then(r => r.json())
      .then(d => {
        setEmailDrafts(d.emails ?? [])
        // by_status is always campaign-wide (unfiltered) — use it as the source of truth
        // so the total never drops to 0 when a status filter returns empty results
        const aggTotal = Object.values<number>(d.by_status ?? {}).reduce((s, n) => s + n, 0)
        setEmailsTotal(aggTotal > 0 ? aggTotal : (d.total ?? 0))
        setEmailsByStatus(d.by_status ?? {})
        setEmailsPages(d.pages ?? 1)
        setEmailsLoading(false)
      })
      .catch(() => setEmailsLoading(false))
  }, [tab, id, emailsFilter, emailsPage, emailsRefreshKey])

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
    // Loop the unitary approve — the only path that actually pushes to the
    // provider (ensureCampaign/enqueueLead/activateCampaign). The former
    // /api/prospect-emails/bulk-approve endpoint only flipped status to
    // 'approved' with no downstream worker, so approved drafts were parked
    // indefinitely — a dead-end bug fixed by /dashboard/approvals.
    const ids = [...selectedEmailIds]
    const BATCH = 4
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(BATCH, ids.length) }, async () => {
      while (true) {
        const i = cursor++
        if (i >= ids.length) return
        try { await fetch(`/api/prospect-emails/${ids[i]}/approve`, { method: 'POST' }) } catch { /* per-item errors swallowed to keep bulk moving; refresh below reveals what succeeded */ }
      }
    }))
    setBulkApprovingEmails(false)
    setSelectedEmailIds(new Set())
    setEmailsRefreshKey(k => k + 1)
  }

  function optimisticEmailStatus(id: string, newStatus: EmailDraft['status']) {
    const prev = { drafts: emailDrafts, byStatus: { ...emailsByStatus } }
    const email = emailDrafts.find(e => e.id === id)
    if (!email) return prev
    const oldStatus = email.status
    setEmailDrafts(ds => ds.map(e => e.id === id ? { ...e, status: newStatus } : e))
    setEmailsByStatus(bs => {
      const next = { ...bs }
      if (oldStatus && next[oldStatus]) next[oldStatus] = Math.max(0, (next[oldStatus] ?? 0) - 1)
      next[newStatus] = (next[newStatus] ?? 0) + 1
      return next
    })
    return prev
  }

  function rollbackEmailStatus(prev: { drafts: EmailDraft[]; byStatus: Record<string, number> }) {
    setEmailDrafts(prev.drafts)
    setEmailsByStatus(prev.byStatus)
    setEmailActionError(tEmails('actionFailed'))
    setTimeout(() => setEmailActionError(''), 3000)
  }

  async function approveEmail(id: string) {
    const prev = optimisticEmailStatus(id, 'approved')
    const res = await fetch(`/api/prospect-emails/${id}/approve`, { method: 'POST' })
    let data: {
      error?: string
      warmup?: { total_daily_capacity?: number; in_warmup?: boolean }
    } = {}
    try { data = await res.json() } catch { /* empty body */ }

    if (!res.ok) {
      rollbackEmailStatus(prev)
      switch (data.error) {
        case 'no_sending_mailbox':
          toast.error(tToasts('mailboxNotReady'), {
            action: {
              label: tToasts('mailboxNotReadyAction'),
              onClick: () => router.push('/dashboard/settings/sending-domains'),
            },
          })
          break
        case 'provider_mock_mode':
          toast.error(tToasts('providerMockMode'))
          break
        case 'send_failed':
        default:
          toast.error(tToasts('sendFailed'))
      }
      return
    }

    // Success — surface warmup capacity once per session so bulk approvers
    // don't get a toast per row.
    if (data.warmup?.in_warmup && !warmupToastShownRef.current) {
      warmupToastShownRef.current = true
      const cap = data.warmup.total_daily_capacity && data.warmup.total_daily_capacity > 0
        ? data.warmup.total_daily_capacity
        : 30
      toast.info(tToasts('warmup', { cap }))
    }
  }

  async function rejectEmail(id: string) {
    const prev = optimisticEmailStatus(id, 'rejected')
    const res = await fetch(`/api/prospect-emails/${id}/reject`, { method: 'POST' })
    if (!res.ok) rollbackEmailStatus(prev)
  }

  async function undoEmail(id: string) {
    const prev = optimisticEmailStatus(id, 'draft')
    const res = await fetch(`/api/prospect-emails/${id}/undo`, { method: 'POST' })
    if (!res.ok) rollbackEmailStatus(prev)
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
    fetch(`/api/campaigns/${id}`)
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
  }, [id])

  async function updateStep(id: string, patch: Partial<Step>) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
    await fetch(`/api/campaigns/${id}/steps/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
  }

  async function aiWriteStep(id: string) {
    setGeneratingStep(id)
    const res = await fetch(`/api/campaigns/${id}/steps/${id}/ai-write`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(r => r.json())
    if (res.step) setSteps(prev => prev.map(s => s.id === id ? { ...s, ...res.step } : s))
    setGeneratingStep(null)
  }

  async function addFollowUp() {
    const res = await fetch(`/api/campaigns/${id}/steps`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(r => r.json())
    if (res.step) setSteps(prev => [...prev, res.step])
  }

  async function removeStep(id: string) {
    await fetch(`/api/campaigns/${id}/steps/${id}`, { method: 'DELETE' })
    setSteps(prev => prev.filter(s => s.id !== id))
  }

  async function generateMissingDrafts() {
    if (!campaign) return
    if (!icpConfigured) {
      toast.error(tIcpGate('toastTitle'), {
        description: tIcpGate('toastDescription'),
        action: {
          label:   tIcpGate('toastCta'),
          onClick: () => { window.location.href = '/dashboard/profile#icp' },
        },
      })
      return
    }
    setGeneratingMissing(true)
    const res = await fetch(`/api/campaigns/${id}/generate-drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: campaign.personalization_mode ?? 'fast' }),
    })
    // Belt-and-suspenders: even if the frontend guard is bypassed, the
    // backend answers 422 with { error: 'icp_not_configured' } and we surface
    // the same toast/CTA rather than a silent failure.
    if (res.status === 422) {
      const body = await res.json().catch(() => null)
      if (body?.error === 'icp_not_configured') {
        toast.error(tIcpGate('toastTitle'), {
          description: tIcpGate('toastDescription'),
          action: {
            label:   tIcpGate('toastCta'),
            onClick: () => { window.location.href = '/dashboard/profile#icp' },
          },
        })
      }
    }
    setGeneratingMissing(false)
    setEmailsRefreshKey(k => k + 1)
  }

  async function patchStopSetting(patch: Partial<typeof stopSettings>) {
    setStopSettings(s => ({ ...s, ...patch }))
    await fetch(`/api/campaigns/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  }

  async function saveCampaignEdit() {
    setSaving(true)
    const res = await fetch(`/api/campaigns/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm),
    }).then(r => r.json())
    if (res.campaign) setCampaign(res.campaign)
    setEditMode(false)
    setSaving(false)
  }

  if (loading) return <div className="text-sm text-[#8a7e6e] py-10 text-center">{t('loading')}</div>
  if (!campaign) return <div className="text-sm text-red-500 py-10 text-center">{t('notFound')}</div>

  const statusLabel = (CAMPAIGN_STATUSES as readonly string[]).includes(campaign.status)
    ? tCampaignStatuses(campaign.status)
    : campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)
  const followUpSteps = steps.filter(s => s.step_order >= 1)

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <Link href="/dashboard/campaigns" className="text-xs text-[#8a7e6e] hover:text-[#1a1a2e] mb-2 inline-block">{tHeader('backToCampaigns')}</Link>
          <h1 className="text-2xl font-bold text-[#1a1a2e] leading-tight">{campaign.name}</h1>
          <p className="text-sm text-[#8a7e6e] mt-0.5">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold mr-2 ${STATUS_COLORS[campaign.status] ?? 'bg-gray-100 text-gray-500'}`}>{statusLabel}</span>
            {tHeader('countsSummary', { prospects: campaign.prospects_count, sent: campaign.sent_count })}
          </p>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-lg mt-3 mb-2">{error}</div>}

      {/* Tabs — overflow-x-auto contains scroll to this strip only */}
      <div className="overflow-x-auto -mx-6 px-6 my-5">
        <div className="flex gap-1 p-1 bg-[#f0ece6] rounded-xl w-fit">
          {([
            { key: 'overview',       label: tTabs('overview') },
            { key: 'prospects',      label: tTabs('prospects', { count: tabProspectsTotal }) },
            { key: 'emails',         label: tTabs('emails', { count: emailsTotal }) },
            { key: 'sequence',       label: tTabs('sequence', { count: followUpSteps.length }) },
          ] as const).map(tab_ => (
            <button key={tab_.key} onClick={() => setTab(tab_.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${tab === tab_.key ? 'bg-white shadow-sm text-[#1a1a2e]' : 'text-[#8a7e6e] hover:text-[#4a4a5a]'}`}>
              {tab_.label}
            </button>
          ))}
          {/* Approval Queue — sibling layout: tab button + info icon to avoid nested interaction */}
          <div className="flex items-center gap-0.5">
            <button onClick={() => setTab('approval_queue')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${tab === 'approval_queue' ? 'bg-white shadow-sm text-[#1a1a2e]' : 'text-[#8a7e6e] hover:text-[#4a4a5a]'}`}>
              {tTabs('approvalQueue', { count: campaign?.pending_drafts_count ?? 0 })}
            </button>
            <Tooltip content={tTabs('approvalQueueTooltip')} placement="bottom">
              <svg className="w-3.5 h-3.5 text-[#b0a898] hover:text-[#3b6bef] transition-colors cursor-help" viewBox="0 0 20 20" fill="currentColor" aria-label={tTabs('approvalQueueAriaLabel')}>
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* ── Tab: Overview ────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          {(() => {
            const pending = campaign.pending_drafts_count ?? 0
            let step: { n: number; title: string; text: string; cta: string; onClick: () => void } | null = null
            if (campaign.prospects_count === 0) {
              step = { n: 1, title: tNextStep('step1Title'), text: tNextStep('step1Description'), cta: tNextStep('step1Cta'), onClick: () => setTab('prospects') }
            } else if (emailsTotal === 0) {
              step = { n: 2, title: tNextStep('step2Title'), text: tNextStep('step2Description', { count: campaign.prospects_count }), cta: tNextStep('step2Cta'), onClick: () => setTab('emails') }
            } else if (pending > 0) {
              step = { n: 3, title: tNextStep('step3Title'), text: tNextStep('step3Description', { count: pending }), cta: tNextStep('step3Cta'), onClick: () => setTab('approval_queue') }
            }
            if (!step) return null
            return (
              <div className="bg-white border border-[#dde6fd] rounded-xl p-5 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold text-[#3b6bef] uppercase tracking-wider mb-1">{tNextStep('stepBadge', { n: step.n })}</div>
                  <div className="text-base font-bold text-[#1a1a2e]">{step.title}</div>
                  <div className="text-sm text-[#6b5e4e] mt-0.5">{step.text}</div>
                </div>
                <button onClick={step.onClick} className="shrink-0 bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
                  {step.cta} →
                </button>
              </div>
            )
          })()}
          {campaign.prospects_count > 0 && emailsTotal > 0 && (campaign.pending_drafts_count ?? 0) === 0 && (
          <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-xl px-4 py-3 text-sm text-[#3b6bef] flex items-center gap-2">
            <span>🚀</span>
            <span>{tOverview('sendingSoon')}</span>
          </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {[
              { key: 'prospects', value: campaign.prospects_count },
              { key: 'sent',      value: campaign.sent_count },
              { key: 'opened',    value: campaign.opened_count },
              { key: 'replied',   value: campaign.replied_count },
              { key: 'meetings',  value: campaign.meeting_count },
            ].map(s => (
              <div key={s.key} className="bg-white border border-[#e8e3dc] rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-[#1a1a2e]">{s.value}</div>
                <div className="text-xs text-[#8a7e6e] uppercase tracking-wider mt-1">{tKpis(s.key)}</div>
              </div>
            ))}
          </div>

          {!editMode ? (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider">{tInfo('title')}</div>
                <button onClick={() => { setEditForm({ name: campaign.name, target_persona: campaign.target_persona ?? '', angle: campaign.angle ?? '', value_prop: campaign.value_prop ?? '', cta: campaign.cta ?? '', proof_points: campaign.proof_points ?? '' }); setEditMode(true) }}
                  className="text-xs text-[#3b6bef] font-medium hover:underline">{tInfo('editButton')}</button>
              </div>
              <div className="flex flex-col gap-3 text-sm">
                {[
                  { key: 'targetPersona', value: campaign.target_persona },
                  { key: 'angle',         value: campaign.angle },
                  { key: 'valueProp',     value: campaign.value_prop },
                  { key: 'cta',           value: campaign.cta },
                  { key: 'proofPoints',   value: campaign.proof_points },
                ].map(f => f.value && (
                  <div key={f.key}>
                    <div className="text-xs font-semibold text-[#6b5e4e] mb-0.5">{tFields(f.key)}</div>
                    <div className="text-[#4a4a5a] leading-relaxed whitespace-pre-wrap">{f.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 flex flex-col gap-3">
              <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-1">{tInfo('editingTitle')}</div>
              {([
                { key: 'name',            fieldKey: 'name',           rows: 1, tooltip: null,                     maxLength: null },
                { key: 'target_persona',  fieldKey: 'targetPersona',  rows: 2, tooltip: null,                     maxLength: null },
                { key: 'angle',           fieldKey: 'angle',          rows: 2, tooltip: null,                     maxLength: null },
                { key: 'value_prop',      fieldKey: 'valueProp',      rows: 2, tooltip: null,                     maxLength: null },
                { key: 'cta',             fieldKey: 'cta',            rows: 1, tooltip: null,                     maxLength: null },
                { key: 'proof_points',    fieldKey: 'proofPoints',    rows: 2, tooltip: tEditForm('proofTooltip'), maxLength: PROOF_MAX },
              ] as const).map(f => {
                const currentVal = ((editForm as any)[f.key] ?? '') as string
                const label = tFields(f.fieldKey)
                const helpId = f.maxLength ? `edit-${f.key}-help` : undefined
                const onChange = (val: string) => setEditForm({ ...editForm, [f.key]: f.maxLength ? val.slice(0, f.maxLength) : val })
                return (
                  <div key={f.key}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <label className="text-xs font-semibold text-[#6b5e4e]" htmlFor={`edit-${f.key}`}>{label}</label>
                      {f.tooltip && (
                        <Tooltip content={f.tooltip} placement="top">
                          <svg className="w-3.5 h-3.5 text-[#b0a898] hover:text-[#3b6bef] transition-colors" viewBox="0 0 20 20" fill="currentColor" aria-label={tEditForm('aboutFieldAria', { label })}>
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                        </Tooltip>
                      )}
                    </div>
                    {f.rows === 1
                      ? <input id={`edit-${f.key}`} value={currentVal} maxLength={f.maxLength ?? undefined} aria-describedby={helpId} onChange={e => onChange(e.target.value)} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
                      : <textarea id={`edit-${f.key}`} value={currentVal} maxLength={f.maxLength ?? undefined} aria-describedby={helpId} onChange={e => onChange(e.target.value)} rows={f.rows} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" />
                    }
                    {f.maxLength && (
                      <p
                        id={helpId}
                        aria-live="polite"
                        className={`text-xs mt-1 ${
                          currentVal.length >= f.maxLength       ? 'text-red-600'
                          : currentVal.length >= f.maxLength * 0.8 ? 'text-amber-600'
                          : 'text-[#8a7e6e]'
                        }`}
                      >
                        {tEditForm('charsHelper', { count: currentVal.length, limit: f.maxLength })}
                      </p>
                    )}
                  </div>
                )
              })}
              <div className="flex gap-2 mt-1">
                <button onClick={() => setEditMode(false)} className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm">{tCommon('cancel')}</button>
                <button onClick={saveCampaignEdit} disabled={saving} className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40">{saving ? tCommon('saving') : tCommon('save')}</button>
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
              {tabProspectsLoading ? tProspects('countLoading') : tProspects('countSummary', { count: tabProspectsTotal })}
            </span>
            <div className="flex gap-2">
              {tabProspects.length > 0 && (
                <button onClick={() => setShowRemoveAll(true)}
                  className="border border-red-200 text-red-500 hover:bg-red-50 px-3 py-2 rounded-lg text-sm font-medium">
                  {tProspects('removeAll')}
                </button>
              )}
              <button onClick={() => setProspectModal('base')}
                className="border border-[#e8e3dc] bg-white text-[#1a1a2e] px-3 py-2 rounded-lg text-sm font-medium hover:bg-[#f5f2ee]">
                {tAddFromBase('trigger')}
              </button>
              <button onClick={() => setProspectModal('manual')}
                className="border border-[#e8e3dc] bg-white text-[#1a1a2e] px-3 py-2 rounded-lg text-sm font-medium hover:bg-[#f5f2ee]">
                {tProspects('addManually')}
              </button>
              <button onClick={() => setProspectModal('csv')}
                className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
                ⬆ {tProspects('importCsv')}
              </button>
            </div>
          </div>

          {/* Desktop table sm+ */}
          <div className="hidden sm:block bg-white border border-[#e8e3dc] rounded-xl overflow-x-auto overflow-hidden">
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
                  {(['name', 'email', 'status', 'source', 'added', 'signals'] as const).map(colKey => (
                    <th key={colKey} className={`text-left px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider${['source','signals'].includes(colKey) ? ' hidden md:table-cell' : ''}`}>{tProspectsCols(colKey)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tabProspectsLoading ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-[#8a7e6e]">{tProspects('countLoading')}</td></tr>
                ) : tabProspects.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center">
                    <div className="text-2xl mb-2">📋</div>
                    <div className="text-sm font-semibold text-[#1a1a2e] mb-1">{tProspects('emptyTitle')}</div>
                    <div className="text-xs text-[#8a7e6e]">{tProspects('emptyDescription')}</div>
                  </td></tr>
                ) : tabProspects.map(p => {
                  const sigCount = Array.isArray(p.prospect_signals) ? (p.prospect_signals[0]?.count ?? 0) : 0
                  const prospectName = [p.contacts?.first_name, p.contacts?.last_name].filter(Boolean).join(' ') || undefined
                  return (
                  <tr
                    key={p.id}
                    onClick={() => setDrawerProspect({ id: p.id, email: p.email, name: prospectName })}
                    className={`border-b border-[#f7f4f0] hover:bg-[#faf8f5] cursor-pointer ${selectedProspectIds.has(p.id) ? 'bg-[#f5f7ff]' : ''}`}
                  >
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
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-[#6b5e4e] bg-[#f0ece6] px-2 py-0.5 rounded-full">
                        {(SOURCE_KEYS as readonly string[]).includes(p.source) ? tSources(p.source) : p.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#8a7e6e]">
                      {p.added_at ? new Date(p.added_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {sigCount > 0 && (
                        <span
                          title={tProspects('signalPillTitle')}
                          className="bg-blue-50 text-blue-600 border border-blue-200 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"
                        >
                          {tProspects('signalPill', { count: sigCount })}
                        </span>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list — <sm */}
          <div className="block sm:hidden space-y-2">
            {tabProspectsLoading ? (
              <div className="py-10 text-center text-sm text-[#8a7e6e]">{tProspects('countLoading')}</div>
            ) : tabProspects.length === 0 ? (
              <div className="py-12 text-center">
                <div className="text-2xl mb-2">📋</div>
                <div className="text-sm font-semibold text-[#1a1a2e] mb-1">{tProspects('emptyTitle')}</div>
                <div className="text-xs text-[#8a7e6e]">{tProspects('emptyDescription')}</div>
              </div>
            ) : tabProspects.map(p => {
              const prospectName = [p.contacts?.first_name, p.contacts?.last_name].filter(Boolean).join(' ') || undefined
              return (
                <CampaignProspectMobileCard
                  key={p.id}
                  prospect={p}
                  isSelected={selectedProspectIds.has(p.id)}
                  onToggleSelect={e => {
                    e.stopPropagation()
                    setSelectedProspectIds(prev => {
                      const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n
                    })
                  }}
                  onClick={() => setDrawerProspect({ id: p.id, email: p.email, name: prospectName })}
                />
              )
            })}
          </div>

          {tabPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setTabPage(p => Math.max(1, p - 1))} disabled={tabPage === 1}
                className="border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-sm text-[#6b5e4e] disabled:opacity-40">{tPagination('prev')}</button>
              <span className="text-sm text-[#8a7e6e]">{tPagination('pageStatus', { current: tabPage, total: tabPages })}</span>
              <button onClick={() => setTabPage(p => Math.min(tabPages, p + 1))} disabled={tabPage === tabPages}
                className="border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-sm text-[#6b5e4e] disabled:opacity-40">{tPagination('next')}</button>
            </div>
          )}

          {selectedProspectIds.size > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
              <div className="pointer-events-auto bg-[#1a1a2e] text-white rounded-2xl shadow-xl px-5 py-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 max-w-[calc(100vw-2rem)]">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{tProspects('bulkSelected', { count: selectedProspectIds.size })}</span>
                  <button onClick={() => setSelectedProspectIds(new Set())}
                    className="text-xs text-white/60 hover:text-white/90 transition-colors">{tProspects('bulkClear')}</button>
                </div>
                <button onClick={bulkDeleteProspects} disabled={bulkDeletingProspects}
                  className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-1.5 rounded-lg disabled:opacity-40 transition-colors">
                  {bulkDeletingProspects ? tProspects('bulkRemoving') : tProspects('bulkRemove')}
                </button>
              </div>
            </div>
          )}

          {showRemoveAll && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-4 sm:p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
                <h2 className="text-base font-bold text-[#1a1a2e] mb-2">{tProspects('removeAllTitle')}</h2>
                <p className="text-sm text-[#6b5e4e] mb-5">
                  {tProspects('removeAllBody', { count: tabProspectsTotal })}
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setShowRemoveAll(false)}
                    className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm">{tCommon('cancel')}</button>
                  <button onClick={removeAllProspects} disabled={removingAll}
                    className="flex-1 bg-red-500 text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40">
                    {removingAll ? tProspects('removeAllRemoving') : tProspects('removeAllConfirm')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {prospectModal === 'csv'    && <ImportCSVModal campaignId={id} campaignName={campaign?.name} onClose={() => setProspectModal(null)} onImported={onProspectImported} />}
          {prospectModal === 'manual' && <ManualAddModal campaignId={id} onClose={() => setProspectModal(null)} onImported={onProspectImported} />}
          <AddFromBaseModal
            isOpen={prospectModal === 'base'}
            campaignId={id}
            onClose={() => setProspectModal(null)}
            onEnrolled={() => onProspectImported({ imported_contacts: 0, updated_contacts: 0, imported_assignments: 0, skipped_assignments_dedup: 0, skipped_invalid: 0, total_contacts_now: 0 })}
          />
        </div>
      )}

      {/* ── Tab: Emails ──────────────────────────────────────────────────────── */}
      {tab === 'emails' && (
        <div className="flex flex-col gap-4">

          {/* Empty: no prospects */}
          {!emailsLoading && tabProspectsTotal === 0 && emailsTotal === 0 && (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-10 text-center">
              <div className="text-3xl mb-3">👥</div>
              <h2 className="text-base font-bold text-[#1a1a2e] mb-2">{tEmails('emptyNoProspectsTitle')}</h2>
              <p className="text-sm text-[#8a7e6e] mb-4">{tEmails('emptyNoProspectsDescription')}</p>
              <button onClick={() => setTab('prospects')}
                className="bg-[#3b6bef] text-white px-5 py-2 rounded-lg text-sm font-semibold">
                {tEmails('emptyNoProspectsCta')}
              </button>
            </div>
          )}

          {/* Empty: has prospects, no drafts yet */}
          {!emailsLoading && tabProspectsTotal > 0 && emailsTotal === 0 && (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-10 text-center">
              <div className="text-3xl mb-3">✉️</div>
              <h2 className="text-base font-bold text-[#1a1a2e] mb-2">{tEmails('emptyNoDraftsTitle')}</h2>
              <p className="text-sm text-[#8a7e6e] mb-4">
                {tEmails('emptyNoDraftsDescription', { count: tabProspectsTotal })}
              </p>
              <button onClick={() => openGenerateDraftsModal(false)}
                className="bg-[#3b6bef] text-white px-5 py-2 rounded-lg text-sm font-semibold">
                ✨ {tEmails('emptyNoDraftsCta')}
              </button>
            </div>
          )}

          {emailActionError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-2.5 rounded-xl">{emailActionError}</div>
          )}

          {/* Populated */}
          {emailsTotal > 0 && (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  {(['all', 'draft', 'edited', 'approved', 'rejected'] as const).map(f => {
                    const count = f === 'all' ? emailsTotal : (emailsByStatus[f] ?? 0)
                    const label = f === 'all' ? tEmails('filters.all') : tEmailStatuses(f)
                    return (
                      <button key={f} onClick={() => { setEmailsFilter(f); setEmailsPage(1) }}
                        className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                          emailsFilter === f
                            ? 'bg-[#1a1a2e] text-white'
                            : 'bg-[#f0ece6] text-[#6b5e4e] hover:bg-[#e8e3dc]'
                        }`}>
                        {tEmails('filterCount', { label, count })}
                      </button>
                    )
                  })}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => openGenerateDraftsModal(true)}
                    className="border border-[#e8e3dc] text-[#6b5e4e] px-3 py-2 rounded-lg text-sm hover:bg-[#f5f2ee]">
                    ↺ {tEmails('regenerateAll')}
                  </button>
                  <button disabled title={tEmails('comingSoonTooltip')}
                    className="border border-[#e8e3dc] text-[#b0a898] px-3 py-2 rounded-lg text-sm cursor-not-allowed flex items-center gap-1.5">
                    📅 {tEmails('schedule')}
                    <span className="text-[9px] bg-[#e8e3dc] text-[#8a7e6e] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide">{tEmails('soonBadge')}</span>
                  </button>
                  <button disabled title={tEmails('comingSoonTooltip')}
                    className="border border-[#e8e3dc] text-[#b0a898] px-3 py-2 rounded-lg text-sm cursor-not-allowed flex items-center gap-1.5">
                    {tEmails('sendAll')}
                    <span className="text-[9px] bg-[#e8e3dc] text-[#8a7e6e] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide">{tEmails('soonBadge')}</span>
                  </button>
                </div>
              </div>

              {/* Missing drafts banner */}
              {!emailsLoading && tabProspectsTotal > emailsTotal && (
                <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                  <p className="text-xs text-amber-800 font-medium">
                    {tEmails('missingBanner', { count: tabProspectsTotal - emailsTotal })}
                  </p>
                  <button
                    onClick={generateMissingDrafts}
                    disabled={generatingMissing}
                    className="shrink-0 text-xs bg-amber-700 hover:bg-amber-800 text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50 transition-colors">
                    {generatingMissing ? tEmails('missingGenerating') : tEmails('missingGenerate')}
                  </button>
                </div>
              )}

              {emailsLoading ? (
                <div className="text-sm text-[#8a7e6e] py-10 text-center">{tEmails('listLoading')}</div>
              ) : emailDrafts.length === 0 ? (
                <div className="bg-white border border-[#e8e3dc] rounded-xl p-8 text-center text-sm text-[#8a7e6e]">
                  {tEmails('listNoMatch')}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {emailDrafts.map(email => {
                    const contactName = [email.prospect.first_name, email.prospect.last_name]
                      .filter(Boolean).join(' ') || email.prospect.email || '—'
                    const bodyPreview = email.body.replace(/\n+/g, ' ').slice(0, 100)
                    const isFinal = email.status === 'approved' || email.status === 'sent' || email.status === 'rejected'

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
                              {email.subject || <span className="italic font-normal text-[#b0a898]">{tEmails('noSubject')}</span>}
                            </div>
                            <div className="text-xs text-[#8a7e6e] truncate mt-0.5">{bodyPreview}…</div>
                          </div>

                          {/* Status badge */}
                          <EmailStatusBadge status={email.status} />

                          {/* Action buttons */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => setEditEmailId(email.id)}
                              className="text-xs text-[#3b6bef] border border-[#dde6fd] bg-[#f7f8ff] hover:bg-[#eef1fd] px-2 py-1 rounded-lg font-medium transition-colors">
                              {tEmails('cardEdit')}
                            </button>
                            {isFinal ? (
                              <button
                                onClick={() => undoEmail(email.id)}
                                className="text-xs text-[#6b5e4e] border border-[#e8e3dc] bg-white hover:bg-[#f5f2ee] px-2 py-1 rounded-lg font-medium transition-colors">
                                {tEmails('cardUndo')}
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => rejectEmail(email.id)}
                                  className="text-xs text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg font-medium transition-colors">
                                  {tEmails('cardReject')}
                                </button>
                                <button
                                  onClick={() => approveEmail(email.id)}
                                  className="text-xs text-green-700 border border-green-200 bg-green-50 hover:bg-green-100 px-2 py-1 rounded-lg font-medium transition-colors">
                                  {tEmails('cardApprove')}
                                </button>
                              </>
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
                    className="border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-sm text-[#6b5e4e] disabled:opacity-40">{tPagination('prev')}</button>
                  <span className="text-sm text-[#8a7e6e]">{tPagination('pageStatus', { current: emailsPage, total: emailsPages })}</span>
                  <button onClick={() => setEmailsPage(p => Math.min(emailsPages, p + 1))} disabled={emailsPage === emailsPages}
                    className="border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-sm text-[#6b5e4e] disabled:opacity-40">{tPagination('next')}</button>
                </div>
              )}
            </>
          )}

          {/* Bulk sticky bar */}
          {selectedEmailIds.size > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
              <div className="pointer-events-auto bg-[#1a1a2e] text-white rounded-2xl shadow-xl px-5 py-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 max-w-[calc(100vw-2rem)]">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{tEmails('bulkSelected', { count: selectedEmailIds.size })}</span>
                  <button onClick={() => setSelectedEmailIds(new Set())}
                    className="text-xs text-white/60 hover:text-white/90 transition-colors">{tEmails('bulkClear')}</button>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={bulkApproveEmails} disabled={bulkApprovingEmails}
                    className="bg-green-500 hover:bg-green-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40 transition-colors">
                    {bulkApprovingEmails ? tEmails('bulkApproving') : tEmails('bulkApprove')}
                  </button>
                  <button onClick={bulkRejectEmails} disabled={bulkRejectingEmails}
                    className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40 transition-colors">
                    {bulkRejectingEmails ? tEmails('bulkRejecting') : tEmails('bulkReject')}
                  </button>
                  <button onClick={bulkDeleteEmails} disabled={bulkDeletingEmails}
                    className="border border-white/20 text-white/80 hover:text-white text-sm px-3 py-1.5 rounded-lg disabled:opacity-40 transition-colors">
                    {bulkDeletingEmails ? tCommon('deleting') : tCommon('delete')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Generate/Regenerate modal */}
          {showGenerateDraftsModal && (
            <GenerateDraftsModal
              campaignId={id}
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
        <div className="flex flex-col max-w-3xl mx-auto w-full">
          {/* Timeline — follow-ups only */}
          <div className="flex flex-col">
            {followUpSteps.map((step, idx) => (
              <StepCard
                key={step.id}
                step={step}
                idx={idx}
                totalSteps={followUpSteps.length}
                saving={generatingStep === step.id}
                onEdit={() => setEditingStep(step)}
                onAiWrite={() => aiWriteStep(step.id)}
                onRemove={() => removeStep(step.id)}
              />
            ))}
          </div>

          {followUpSteps.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center mb-4">
              <div className="text-3xl mb-3">↩️</div>
              <p className="text-sm font-semibold text-[#1a1a2e] mb-1">{t('sequence.emptyTitle')}</p>
              <p className="text-xs text-[#8a7e6e] mb-4">{t('sequence.emptyDescription')}</p>
              {(campaign?.prospects_count ?? 0) > 0 && (
                <button
                  onClick={() => openGenerateDraftsModal(false)}
                  className="bg-[#3b6bef] text-white px-5 py-2 rounded-lg text-sm font-semibold"
                >
                  ✨ {t('sequence.emptyCta')}
                </button>
              )}
            </div>
          )}

          {/* Add follow-up step */}
          <button onClick={addFollowUp}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-transparent border-[1.5px] border-dashed border-gray-200 rounded-[10px] text-gray-500 text-[0.85rem] font-medium cursor-pointer mt-1 hover:border-blue-600 hover:text-blue-600 hover:bg-blue-50 transition">
            <span className="text-[1.1rem]">+</span> {t('sequence.addFollowUp')}
          </button>

          {/* Smart Stop Conditions — autonomous card */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 mt-5">
            <div className="text-[0.8rem] font-semibold text-gray-500 uppercase tracking-[0.4px] mb-3">
              {t('sequence.smartStopTitle')}
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg mb-2">
              <div>
                <div className="text-[0.88rem] font-medium text-gray-900">{t('sequence.stopOnReplyLabel')}</div>
                <div className="text-[0.78rem] text-gray-500 mt-0.5">{t('sequence.stopOnReplyDescription')}</div>
              </div>
              <Toggle checked={stopSettings.smart_stop_on_reply} onChange={v => patchStopSetting({ smart_stop_on_reply: v })} />
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <div>
                <div className="text-[0.88rem] font-medium text-gray-900">{t('sequence.stopOnBounceLabel')}</div>
                <div className="text-[0.78rem] text-gray-500 mt-0.5">{t('sequence.stopOnBounceDescription')}</div>
              </div>
              <Toggle checked={stopSettings.smart_stop_on_bounce} onChange={v => patchStopSetting({ smart_stop_on_bounce: v })} />
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Approval Queue ──────────────────────────────────────────────── */}
      {tab === 'approval_queue' && (
        <ApprovalQueueClient campaignId={id} />
      )}

      {/* EditFollowupModal — top-level so it works from any tab */}
      {editingStep && (
        <EditFollowupModal
          step={editingStep}
          onClose={() => setEditingStep(null)}
          onSave={async updated => {
            await fetch(`/api/campaigns/${id}/steps/${editingStep.id}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated),
            })
            setSteps(prev => prev.map(s => s.id === editingStep.id ? { ...s, ...updated } : s))
            setEditingStep(null)
          }}
        />
      )}

      {drawerProspect && (
        <ProspectSignalsDrawer
          open={true}
          onClose={() => setDrawerProspect(null)}
          prospectId={drawerProspect.id}
          prospectEmail={drawerProspect.email}
          prospectName={drawerProspect.name}
        />
      )}
    </div>
  )
}

function StepCard({ step, idx, totalSteps, saving, onEdit, onAiWrite, onRemove }: {
  step: Step; idx: number; totalSteps: number; saving: boolean
  onEdit: () => void; onAiWrite: () => void; onRemove: () => void
}) {
  const t = useTranslations('dashboard.campaigns.detail.sequence')
  return (
    <div className="flex gap-4 items-start mb-2">
      {/* Left column: pill + vertical connector */}
      <div className="flex flex-col items-center flex-shrink-0 w-8">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[0.78rem] font-semibold text-white flex-shrink-0 bg-blue-600">
          {idx + 1}
        </div>
        {idx < totalSteps - 1 && (
          <div className="w-0.5 flex-1 min-h-5 bg-gray-200 mt-1" />
        )}
      </div>

      {/* Card — read-only */}
      <div className="flex-1 bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[0.82rem] font-semibold text-gray-500 uppercase tracking-[0.4px]">
            {t('followUpNumber', { n: idx + 1 })}
          </span>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 mb-3">
          <span className="text-[0.82rem] text-gray-700">
            {t.rich('sendAfter', {
              days: step.delay_days,
              strong: chunks => <span className="font-semibold text-gray-900">{chunks}</span>,
            })}
          </span>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 mb-2">
          <div className="text-[0.7rem] uppercase tracking-wider text-gray-400 mb-1">{t('subjectLabel')}</div>
          <div className="text-[0.88rem] text-gray-900">
            {step.subject || <span className="text-gray-400 italic">{t('subjectFallback')}</span>}
          </div>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 mb-3">
          <div className="text-[0.7rem] uppercase tracking-wider text-gray-400 mb-1">{t('bodyLabel')}</div>
          <div className="text-[0.85rem] text-gray-700 leading-[1.55] line-clamp-3 whitespace-pre-wrap">
            {step.body || <span className="text-gray-400 italic">{t('bodyFallback')}</span>}
          </div>
        </div>

        <div className="text-[0.78rem] text-gray-500 mb-3 flex items-center gap-1.5">
          {t('bookingLinkLabel')}{' '}
          <span className={step.include_booking_link ? 'text-green-600 font-medium' : 'text-gray-400'}>
            {step.include_booking_link ? t('bookingIncluded') : t('bookingNotIncluded')}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          <button onClick={onEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 border border-gray-200 rounded-lg text-[0.8rem] font-medium cursor-pointer hover:bg-gray-200 transition">
            {t('edit')}
          </button>
          <button onClick={onAiWrite} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-50 text-violet-600 border border-violet-600/20 rounded-lg text-[0.8rem] font-medium cursor-pointer hover:bg-violet-100 transition disabled:opacity-50 disabled:cursor-not-allowed">
            {saving
              ? <span className="w-3 h-3 border border-violet-300 border-t-violet-600 rounded-full animate-spin" />
              : '✦'} {t('aiWrite')}
          </button>
          <button onClick={onRemove} disabled={saving}
            className="ml-auto px-3 py-1.5 bg-red-50 text-red-500 border border-red-500/20 rounded-lg text-[0.8rem] font-medium cursor-pointer hover:bg-red-100 transition disabled:opacity-50">
            {t('remove')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  )
}
