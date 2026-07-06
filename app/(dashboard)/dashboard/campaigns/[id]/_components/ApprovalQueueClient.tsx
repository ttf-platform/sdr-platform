'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { VariantEditModal } from './VariantEditModal'

type Variant = {
  id: string
  subject: string
  body: string
  signal_ids: string[]
  template_subject: string | null
  template_body: string | null
  status: 'draft' | 'edited' | 'approved' | 'rejected'
  edited_subject: string | null
  edited_body: string | null
  generated_at: string
  approved_at: string | null
  prospects: {
    id: string
    email: string
    campaign_id: string
    contacts: {
      first_name: string | null
      last_name: string | null
      company: string | null
      title: string | null
    } | null
  }
  campaign_steps: {
    id: string
    step_order: number
    delay_days: number | null
  }
}

type ProspectWithSignals = {
  id: string
  prospect_signals?: [{ count: number }] | null
}

type ApprovalQueueClientProps = {
  campaignId: string
}

export function ApprovalQueueClient({ campaignId }: ApprovalQueueClientProps) {
  const t = useTranslations('dashboard.campaigns.detail.approvalQueue')
  const tErrors = useTranslations('dashboard.campaigns.detail.approvalQueue.errors')
  const tHeader = useTranslations('dashboard.campaigns.detail.approvalQueue.variantHeader')

  const [variants, setVariants] = useState<Variant[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [editingVariant, setEditingVariant] = useState<Variant | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  async function fetchVariants() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/approval-queue`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? tErrors('loadFailed'))
      setVariants(data.variants ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : tErrors('loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchVariants()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId])

  async function handleAction(variantId: string, action: 'approve' | 'reject') {
    setActionInProgress(variantId)
    try {
      await fetch(`/api/prospect-email-variants/${variantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      setVariants(prev => prev.filter(v => v.id !== variantId))
    } catch (e) {
      setError(e instanceof Error ? e.message : tErrors('actionFailed'))
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleGenerateForMatched() {
    setGenerating(true)
    setError(null)
    try {
      const prospectsRes = await fetch(`/api/prospects?campaign_id=${campaignId}&limit=100`)
      const prospectsData = await prospectsRes.json()
      const prospectsWithSignals = (prospectsData.prospects ?? [] as ProspectWithSignals[]).filter((p: ProspectWithSignals) => {
        const count = Array.isArray(p.prospect_signals) ? (p.prospect_signals[0]?.count ?? 0) : 0
        return count > 0
      })

      if (prospectsWithSignals.length === 0) {
        setError(tErrors('noMatchedProspects'))
        setGenerating(false)
        return
      }

      for (const p of prospectsWithSignals as ProspectWithSignals[]) {
        await fetch(`/api/prospects/${p.id}/generate-personalized`, { method: 'POST' })
      }

      await fetchVariants()
    } catch (e) {
      setError(e instanceof Error ? e.message : tErrors('generationFailed'))
    } finally {
      setGenerating(false)
    }
  }

  async function handleBatchApprove() {
    if (!confirm(t('confirmBatch', { count: variants.length }))) return
    setActionInProgress('batch')
    try {
      await Promise.all(
        variants.map(v =>
          fetch(`/api/prospect-email-variants/${v.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'approve' }),
          })
        )
      )
      setVariants([])
    } catch (e) {
      setError(e instanceof Error ? e.message : tErrors('batchApproveFailed'))
    } finally {
      setActionInProgress(null)
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-[#8a7e6e]">{t('loading')}</div>
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header actions */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[#1a1a2e]">{t('title')}</h2>
          <p className="text-xs text-[#8a7e6e] mt-0.5">
            {t('subtitle', { count: variants.length })}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={handleGenerateForMatched}
            disabled={generating}
            className="border border-[#3b6bef] text-[#3b6bef] rounded-lg px-3 py-2 text-xs font-medium hover:bg-[#f7f8ff] transition-colors disabled:opacity-40"
          >
            {generating ? t('generating') : `✨ ${t('generateBtn')}`}
          </button>
          {variants.length > 0 && (
            <button
              onClick={handleBatchApprove}
              disabled={actionInProgress === 'batch'}
              className="bg-[#3b6bef] text-white rounded-lg px-3 py-2 text-xs font-medium hover:bg-[#2d5cdc] transition-colors disabled:opacity-40"
            >
              {actionInProgress === 'batch' ? t('approving') : t('batchApprove', { count: variants.length })}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Empty state */}
      {variants.length === 0 && !generating && (
        <div className="border border-[#e8e3dc] rounded-xl p-8 text-center">
          <p className="text-3xl mb-2">📭</p>
          <p className="text-sm font-semibold text-[#1a1a2e] mb-1">{t('emptyTitle')}</p>
          <p className="text-xs text-[#8a7e6e] max-w-sm mx-auto">
            {t('emptyDescription')}
          </p>
        </div>
      )}

      {/* Variants list */}
      <div className="flex flex-col gap-3">
        {variants.map(v => {
          const contact = Array.isArray(v.prospects)
            ? (v.prospects as unknown as Variant['prospects'][])[0]?.contacts
            : (v.prospects as Variant['prospects'])?.contacts
          const email = Array.isArray(v.prospects)
            ? (v.prospects as unknown as Variant['prospects'][])[0]?.email ?? ''
            : (v.prospects as Variant['prospects'])?.email ?? ''
          const prospectName = `${contact?.first_name ?? ''} ${contact?.last_name ?? ''}`.trim() || email
          const step = Array.isArray(v.campaign_steps)
            ? (v.campaign_steps as unknown as Variant['campaign_steps'][])[0]
            : (v.campaign_steps as Variant['campaign_steps'])
          const displaySubject = v.status === 'edited' ? (v.edited_subject ?? v.subject) : v.subject
          const displayBody = v.status === 'edited' ? (v.edited_body ?? v.body) : v.body
          const stepOrder = step?.step_order ?? tHeader('stepUnknown')

          return (
            <div key={v.id} className="border border-[#e8e3dc] rounded-xl p-4">
              {/* Prospect header */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-[#1a1a2e]">{prospectName}</p>
                  <p className="text-xs text-[#8a7e6e]">
                    {email}{contact?.company ? ` · ${contact.company}` : ''}
                  </p>
                </div>
                <span className="bg-blue-50 text-blue-600 border border-blue-200 rounded-full px-2.5 py-0.5 text-xs font-medium flex-shrink-0 ml-2">
                  {tHeader('signalsBadge', { count: v.signal_ids.length, step: stepOrder })}
                </span>
              </div>

              {/* Email preview */}
              <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-lg p-3 mb-3">
                <p className="text-xs font-semibold text-[#3b6bef] mb-1">{t('subjectLabel')}</p>
                <p className="text-sm text-[#1a1a2e] mb-3">{displaySubject}</p>
                <p className="text-xs font-semibold text-[#3b6bef] mb-1">{t('bodyLabel')}</p>
                <p className="text-sm text-[#1a1a2e] whitespace-pre-wrap leading-relaxed">{displayBody}</p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => handleAction(v.id, 'reject')}
                  disabled={actionInProgress === v.id}
                  className="border border-red-200 text-red-600 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-red-50 transition-colors disabled:opacity-40"
                >
                  {t('reject')}
                </button>
                <button
                  onClick={() => setEditingVariant(v)}
                  disabled={actionInProgress === v.id}
                  className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-[#f7f4f0] transition-colors disabled:opacity-40"
                >
                  {t('edit')}
                </button>
                <button
                  onClick={() => handleAction(v.id, 'approve')}
                  disabled={actionInProgress === v.id}
                  className="bg-green-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-green-700 transition-colors disabled:opacity-40"
                >
                  {t('approve')}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {editingVariant && (
        <VariantEditModal
          isOpen={true}
          variant={editingVariant}
          onClose={() => setEditingVariant(null)}
          onSaved={async () => {
            setEditingVariant(null)
            await fetchVariants()
          }}
        />
      )}
    </div>
  )
}
