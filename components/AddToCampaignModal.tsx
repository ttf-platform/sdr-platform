'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'

interface Campaign {
  id:   string
  name: string
}

interface Props {
  isOpen:     boolean
  onClose:    () => void
  contactIds: string[]
  campaigns:  Campaign[]
  onAdded:    () => void
}

export function AddToCampaignModal({ isOpen, onClose, contactIds, campaigns, onAdded }: Props) {
  const t = useTranslations('components.addToCampaignModal')
  const tCommon = useTranslations('dashboard.common')

  const [campaignId, setCampaignId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setCampaignId('')
    setError(null)
  }, [isOpen])

  const hasCampaigns = campaigns.length > 0

  async function submit() {
    if (!campaignId || contactIds.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/prospects`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contact_ids: contactIds }),
      })
      if (!res.ok) {
        setError(t('error'))
        setSubmitting(false)
        return
      }
      const data = await res.json() as { enrolled: number; skipped_dedup: number }
      toast.success(t('successAdded', { count: data.enrolled }))
      if (data.skipped_dedup > 0) {
        toast.message(t('successSkipped', { count: data.skipped_dedup }))
      }
      onAdded()
      onClose()
    } catch {
      setError(t('error'))
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('title', { count: contactIds.length })}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-sm border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-[#6b5e4e] hover:bg-[#f5f2ee] disabled:opacity-40"
          >
            {tCommon('cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !campaignId || !hasCampaigns}
            className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? t('submitting') : t('submit')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && (
          <div role="alert" className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>
        )}

        {hasCampaigns ? (
          <select
            value={campaignId}
            onChange={e => setCampaignId(e.target.value)}
            className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm bg-white text-[#1a1a2e] focus:outline-none focus:border-[#3b6bef]"
          >
            <option value="" disabled>{t('selectPlaceholder')}</option>
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        ) : (
          <div className="text-sm text-[#8a7e6e] bg-[#f5f2ee] border border-[#e8e3dc] rounded-lg p-4">
            {t('noCampaigns')}
          </div>
        )}
      </div>
    </Modal>
  )
}
