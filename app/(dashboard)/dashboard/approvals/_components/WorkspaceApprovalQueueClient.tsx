'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { EditEmailModal } from '@/components/EditEmailModal'

type DraftItem = {
  id:            string
  subject:       string
  body:          string
  mode:          'fast' | 'smart' | null
  status:        'draft' | 'edited'
  generated_at:  string
  step_order:    number | null
  step_type:     string | null
  prospect: {
    id:         string
    email:      string | null
    first_name: string | null
    last_name:  string | null
    company:    string | null
    title:      string | null
  }
}

type CampaignGroup = {
  campaign: {
    id:                   string
    name:                 string
    status:               string | null
    personalization_mode: 'fast' | 'smart' | null
  }
  drafts:       DraftItem[]
  drafts_count: number
}

type ApiResponse = {
  groups:          CampaignGroup[]
  total_drafts:    number
  total_campaigns: number
}

// Distinct error codes we surface with a friendly reason from /[id]/approve.
// Any other server error rolls up under a generic "generation error" bucket.
type ApproveError =
  | 'no_sending_mailbox'
  | 'provider_mock_mode'
  | 'already_sent'
  | 'send_failed'
  | 'not_found'
  | 'campaign_step_missing'
  | 'campaign_missing'
  | 'other'

const APPROVE_CONCURRENCY = 4

// Small concurrency-limited runner. Each task returns a discriminated result
// so partial failures never abort the batch. Kept inline to avoid a helper
// module for a five-liner used in one place.
async function runWithLimit<TIn, TOut>(items: TIn[], limit: number, task: (item: TIn) => Promise<TOut>): Promise<TOut[]> {
  const out: TOut[] = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      out[i] = await task(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

type ApproveResult = { id: string; ok: true } | { id: string; ok: false; error: ApproveError }

async function approveOne(id: string): Promise<ApproveResult> {
  try {
    const res = await fetch(`/api/prospect-emails/${id}/approve`, { method: 'POST' })
    if (res.ok) return { id, ok: true }
    let body: { error?: string } = {}
    try { body = await res.json() } catch { /* empty */ }
    const code = (body?.error ?? 'other') as ApproveError
    return { id, ok: false, error: code }
  } catch {
    return { id, ok: false, error: 'other' }
  }
}

async function rejectOne(id: string): Promise<{ id: string; ok: boolean }> {
  try {
    const res = await fetch(`/api/prospect-emails/${id}/reject`, { method: 'POST' })
    return { id, ok: res.ok }
  } catch {
    return { id, ok: false }
  }
}

export function WorkspaceApprovalQueueClient() {
  const t     = useTranslations('dashboard.approvals')
  const tErr  = useTranslations('dashboard.approvals.errors')

  const [data,     setData]     = useState<ApiResponse | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [busy,     setBusy]     = useState<'idle' | 'unit' | 'bulk'>('idle')
  const [busyId,   setBusyId]   = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [flash,    setFlash]    = useState<{ kind: 'ok' | 'partial'; text: string } | null>(null)
  const [editing,  setEditing]  = useState<{ id: string; personalizationMode: 'fast' | 'smart' | null } | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/prospect-emails/approval-queue')
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'load_failed')
      setData(json as ApiResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(null), 6000)
    return () => clearTimeout(timer)
  }, [flash])

  async function handleApprove(id: string) {
    if (busy !== 'idle') return
    setBusy('unit'); setBusyId(id)
    const result = await approveOne(id)
    setBusyId(null); setBusy('idle')
    if (result.ok) {
      // Drop the row locally, no need to refetch the whole list.
      setData(prev => prev ? removeDraft(prev, id) : prev)
    } else {
      setFlash({ kind: 'partial', text: tErr(result.error) })
    }
  }

  async function handleReject(id: string) {
    if (busy !== 'idle') return
    setBusy('unit'); setBusyId(id)
    const result = await rejectOne(id)
    setBusyId(null); setBusy('idle')
    if (result.ok) {
      setData(prev => prev ? removeDraft(prev, id) : prev)
    } else {
      setFlash({ kind: 'partial', text: tErr('reject_failed') })
    }
  }

  async function bulkApprove(ids: string[], scope: 'campaign' | 'all') {
    if (busy !== 'idle' || ids.length === 0) return

    if (scope === 'all') {
      const groups = data?.groups ?? []
      const parts = groups
        .filter(g => g.drafts.some(d => ids.includes(d.id)))
        .map(g => `${g.campaign.name}: ${g.drafts.filter(d => ids.includes(d.id)).length}`)
        .join('\n')
      if (!confirm(t('confirmBulkAll', { count: ids.length, campaigns: parts }))) return
    }

    setBusy('bulk')
    setProgress({ done: 0, total: ids.length })

    const results: ApproveResult[] = []
    await runWithLimit(ids, APPROVE_CONCURRENCY, async (id) => {
      const r = await approveOne(id)
      results.push(r)
      setProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null)
      return r
    })

    setProgress(null)
    setBusy('idle')

    const okIds = new Set(results.filter(r => r.ok).map(r => r.id))
    const failures = results.filter(r => !r.ok) as Array<Extract<ApproveResult, { ok: false }>>

    // Remove approved drafts locally so the queue shortens visually.
    setData(prev => prev ? removeManyDrafts(prev, okIds) : prev)

    if (failures.length === 0) {
      setFlash({ kind: 'ok', text: t('flashApprovedAll', { count: okIds.size }) })
    } else {
      const reasons = summarizeFailures(failures.map(f => f.error), tErr)
      setFlash({
        kind: 'partial',
        text: t('flashApprovedPartial', { ok: okIds.size, failed: failures.length, reasons }),
      })
    }
  }

  const totals = useMemo(() => ({
    drafts:    data?.total_drafts ?? 0,
    campaigns: data?.total_campaigns ?? 0,
  }), [data])

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-8 text-center text-sm text-[#8a7e6e]">
        {t('loading')}
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {t('loadError')}
          <button onClick={refresh} className="ml-2 underline">{t('retry')}</button>
        </div>
      </div>
    )
  }

  if (totals.drafts === 0) {
    return (
      <div className="max-w-4xl mx-auto">
        <Header title={t('title')} subtitle={t('subtitleEmpty')} />
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-10 text-center mt-4">
          <p className="text-4xl mb-3">📭</p>
          <p className="text-base font-semibold text-[#1a1a2e] mb-2">{t('emptyTitle')}</p>
          <p className="text-sm text-[#8a7e6e] mb-5 max-w-md mx-auto">{t('emptyDescription')}</p>
          <Link
            href="/dashboard/campaigns"
            className="inline-flex items-center gap-2 bg-[#3b6bef] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#2d5cdc] transition-colors"
          >
            {t('emptyCta')}
          </Link>
        </div>
      </div>
    )
  }

  const allDraftIds = (data?.groups ?? []).flatMap(g => g.drafts.map(d => d.id))

  return (
    <div className="max-w-4xl mx-auto">
      <Header
        title={t('title')}
        subtitle={t('subtitle', { drafts: totals.drafts, campaigns: totals.campaigns })}
      >
        <button
          onClick={() => bulkApprove(allDraftIds, 'all')}
          disabled={busy !== 'idle'}
          className="bg-[#3b6bef] text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-[#2d5cdc] transition-colors disabled:opacity-40"
        >
          {busy === 'bulk'
            ? t('bulkApproveInProgress', { done: progress?.done ?? 0, total: progress?.total ?? 0 })
            : t('bulkApproveAll', { count: totals.drafts })}
        </button>
      </Header>

      {busy === 'bulk' && progress && (
        <div className="mt-4">
          <div className="h-1.5 bg-[#e8e3dc] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#3b6bef] transition-[width] duration-200"
              style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {flash && busy !== 'bulk' && (
        <div
          className={
            'mt-3 rounded-lg border px-4 py-3 text-sm ' +
            (flash.kind === 'ok'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-amber-50 border-amber-200 text-amber-800 whitespace-pre-line')
          }
        >
          {flash.text}
        </div>
      )}

      <div className="flex flex-col gap-6 mt-6">
        {(data?.groups ?? []).map(group => (
          <CampaignSection
            key={group.campaign.id}
            group={group}
            busy={busy}
            busyId={busyId}
            onApprove={handleApprove}
            onReject={handleReject}
            onEdit={draft => setEditing({ id: draft.id, personalizationMode: group.campaign.personalization_mode })}
            onBulkCampaign={() => bulkApprove(group.drafts.map(d => d.id), 'campaign')}
          />
        ))}
      </div>

      {editing && (
        <EditEmailModal
          emailId={editing.id}
          campaignPersonalizationMode={editing.personalizationMode}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await refresh()
          }}
        />
      )}
    </div>
  )
}

function Header({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-bold text-[#1a1a2e]">{title}</h1>
        <p className="text-sm text-[#8a7e6e] mt-0.5">{subtitle}</p>
      </div>
      {children && <div className="flex-shrink-0">{children}</div>}
    </div>
  )
}

function CampaignSection({
  group,
  busy,
  busyId,
  onApprove,
  onReject,
  onEdit,
  onBulkCampaign,
}: {
  group:            CampaignGroup
  busy:             'idle' | 'unit' | 'bulk'
  busyId:           string | null
  onApprove:        (id: string) => void
  onReject:         (id: string) => void
  onEdit:           (draft: DraftItem) => void
  onBulkCampaign:   () => void
}) {
  const t = useTranslations('dashboard.approvals')

  return (
    <section className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#f0ece6]">
        <div className="min-w-0">
          <Link
            href={`/dashboard/campaigns/${group.campaign.id}?tab=emails`}
            className="text-sm font-semibold text-[#1a1a2e] hover:text-[#3b6bef] transition-colors truncate block"
          >
            {group.campaign.name}
          </Link>
          <p className="text-xs text-[#8a7e6e] mt-0.5">
            {t('campaignSubtitle', { count: group.drafts_count })}
          </p>
        </div>
        <button
          onClick={onBulkCampaign}
          disabled={busy !== 'idle'}
          className="text-xs font-medium text-[#3b6bef] hover:underline disabled:opacity-40 disabled:no-underline flex-shrink-0"
        >
          {t('bulkApproveCampaign', { count: group.drafts_count })}
        </button>
      </div>

      <ul className="flex flex-col divide-y divide-[#f0ece6]">
        {group.drafts.map(draft => (
          <DraftRow
            key={draft.id}
            draft={draft}
            busy={busy}
            busyId={busyId}
            onApprove={() => onApprove(draft.id)}
            onReject={() => onReject(draft.id)}
            onEdit={() => onEdit(draft)}
          />
        ))}
      </ul>
    </section>
  )
}

function DraftRow({
  draft,
  busy,
  busyId,
  onApprove,
  onReject,
  onEdit,
}: {
  draft:      DraftItem
  busy:       'idle' | 'unit' | 'bulk'
  busyId:     string | null
  onApprove:  () => void
  onReject:   () => void
  onEdit:     () => void
}) {
  const t = useTranslations('dashboard.approvals')
  const disabled = busy !== 'idle'
  const rowBusy  = busy === 'unit' && busyId === draft.id
  const prospectName = `${draft.prospect.first_name ?? ''} ${draft.prospect.last_name ?? ''}`.trim() || draft.prospect.email || '—'
  const contextLine = [draft.prospect.email, draft.prospect.company].filter(Boolean).join(' · ')

  return (
    <li className="px-5 py-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#1a1a2e] truncate">{prospectName}</p>
          {contextLine && <p className="text-xs text-[#8a7e6e] mt-0.5 truncate">{contextLine}</p>}
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[#f0ece6] text-[#6b5e4e] flex-shrink-0">
          {t('stepBadge', { step: (draft.step_order ?? 0) + 1 })}
        </span>
      </div>

      <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-lg p-3 mb-3">
        <p className="text-xs font-semibold text-[#3b6bef] mb-1">{t('subjectLabel')}</p>
        <p className="text-sm text-[#1a1a2e] mb-3 break-words">{draft.subject}</p>
        <p className="text-xs font-semibold text-[#3b6bef] mb-1">{t('bodyLabel')}</p>
        <p className="text-sm text-[#1a1a2e] whitespace-pre-wrap leading-relaxed break-words">{draft.body}</p>
      </div>

      <div className="flex gap-2 flex-wrap justify-end">
        <button
          onClick={onReject}
          disabled={disabled}
          className="border border-red-200 text-red-600 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-red-50 transition-colors disabled:opacity-40"
        >
          {t('reject')}
        </button>
        <button
          onClick={onEdit}
          disabled={disabled}
          className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-[#f7f4f0] transition-colors disabled:opacity-40"
        >
          {t('edit')}
        </button>
        <button
          onClick={onApprove}
          disabled={disabled}
          className="bg-[#3b6bef] text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-[#2d5cdc] transition-colors disabled:opacity-40 min-w-[6rem]"
        >
          {rowBusy ? t('approving') : t('approve')}
        </button>
      </div>
    </li>
  )
}

// ─── Local state helpers ─────────────────────────────────────────────────────

function removeDraft(data: ApiResponse, id: string): ApiResponse {
  const groups: CampaignGroup[] = []
  for (const group of data.groups) {
    const drafts = group.drafts.filter(d => d.id !== id)
    if (drafts.length > 0) {
      groups.push({ ...group, drafts, drafts_count: drafts.length })
    }
  }
  return {
    groups,
    total_drafts:    groups.reduce((n, g) => n + g.drafts_count, 0),
    total_campaigns: groups.length,
  }
}

function removeManyDrafts(data: ApiResponse, ids: Set<string>): ApiResponse {
  const groups: CampaignGroup[] = []
  for (const group of data.groups) {
    const drafts = group.drafts.filter(d => !ids.has(d.id))
    if (drafts.length > 0) {
      groups.push({ ...group, drafts, drafts_count: drafts.length })
    }
  }
  return {
    groups,
    total_drafts:    groups.reduce((n, g) => n + g.drafts_count, 0),
    total_campaigns: groups.length,
  }
}

function summarizeFailures(errors: ApproveError[], tErr: (k: string) => string): string {
  const counts = new Map<ApproveError, number>()
  for (const e of errors) counts.set(e, (counts.get(e) ?? 0) + 1)
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${n} · ${tErr(code)}`)
    .join('\n')
}
