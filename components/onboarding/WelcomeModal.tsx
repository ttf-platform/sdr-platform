'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Modal } from '@/components/ui/Modal'
import { motion } from 'framer-motion'

type StepKey =
  | 'icp_configured'
  | 'mailbox_connected'
  | 'campaign_created'
  | 'prospects_added'
  | 'campaign_launched'

const STEP_ICONS: Record<StepKey, string> = {
  icp_configured:    '🎯',
  mailbox_connected: '✉️',
  campaign_created:  '🚀',
  prospects_added:   '👥',
  campaign_launched: '📤',
}

const STEP_ORDER: StepKey[] = [
  'icp_configured',
  'mailbox_connected',
  'campaign_created',
  'prospects_added',
  'campaign_launched',
]

interface WelcomeModalProps {
  /** Called by the "Let's go", "Try sample data", the built-in X, and ESC.
   *  Semantics: modal closes for the current tab session but returns at the
   *  next login. Provider persists a sessionStorage flag only, no DB write. */
  onDismissTemporary: () => Promise<void> | void
  /** Called by the small "Don't show this again" link. Semantics: PATCH
   *  welcome_dismissed_permanently=true. Modal will not auto-show again
   *  until the user explicitly triggers Replay welcome tour from the
   *  avatar dropdown. */
  onDismissPermanent: () => Promise<void> | void
  /** Called after "Let's go" temporary-dismiss completes. Provider wires this
   *  to router.push('/dashboard/profile#icp') so the user lands on step 1. */
  onLetsGo?: () => void
  /** Called after "Try with sample data" seeds the sample workspace. Receives
   *  the demo campaign_id so the provider can deep-link into the approval
   *  queue (the aha screen with 5 pre-generated drafts). */
  onTrySample?: (r: { campaign_id: string }) => void
}

export function WelcomeModal({ onDismissTemporary, onDismissPermanent, onLetsGo, onTrySample }: WelcomeModalProps) {
  const t = useTranslations('components.onboarding.welcome')
  const [isOpen,          setIsOpen]          = useState(true)
  const [submitting,      setSubmitting]       = useState(false)
  const [loadingSample,   setLoadingSample]    = useState(false)
  const [confirmingNever, setConfirmingNever]  = useState(false)

  async function handleClose() {
    setSubmitting(true)
    await onDismissTemporary()
    setIsOpen(false)
    onLetsGo?.()
  }

  async function handleTrySample() {
    setLoadingSample(true)
    try {
      const res = await fetch('/api/onboarding/load-sample-data', { method: 'POST' })
      const data = (await res.json()) as { ok?: boolean; campaign_id?: string }
      await onDismissTemporary()
      setIsOpen(false)
      if (data.campaign_id && onTrySample) {
        onTrySample({ campaign_id: data.campaign_id })
      } else {
        window.location.reload()
      }
    } catch {
      setLoadingSample(false)
    }
  }

  async function handleNever() {
    setConfirmingNever(true)
    await onDismissPermanent()
    setIsOpen(false)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="lg"
      title={t('title')}
      description={t('description')}
      closeOnBackdropClick={false}
      footer={
        <div className="flex flex-col gap-2 w-full">
          <button
            onClick={handleClose}
            disabled={submitting || loadingSample || confirmingNever}
            className="w-full bg-[#1a1a2e] hover:bg-[#2a2a3e] text-white font-semibold py-3 px-6 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {submitting ? t('cta.letsGoLoading') : t('cta.letsGo')}
          </button>
          <button
            onClick={handleTrySample}
            disabled={submitting || loadingSample || confirmingNever}
            className="w-full border border-[#e8e3dc] bg-white hover:bg-[#f7f4f0] text-[#6b5e4e] font-medium py-2.5 px-6 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {loadingSample ? t('cta.trySampleLoading') : t('cta.trySample')}
          </button>
          <button
            type="button"
            onClick={handleNever}
            disabled={submitting || loadingSample || confirmingNever}
            className="mt-1 mx-auto text-xs text-[#8a7e6e] hover:text-[#4a4a5a] underline underline-offset-2 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2 rounded"
          >
            {confirmingNever ? t('cta.neverSaving') : t('cta.never')}
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
        {STEP_ORDER.map((key, idx) => (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.07, duration: 0.25, ease: 'easeOut' }}
            className="flex gap-3 p-3 rounded-lg border border-[#e8e3dc] bg-[#fdfcfb]"
          >
            <span className="text-xl leading-none shrink-0 mt-0.5">{STEP_ICONS[key]}</span>
            <div className="min-w-0">
              <div className="font-semibold text-sm text-[#1a1a2e] leading-snug">{t(`steps.${key}.title`)}</div>
              <div className="text-xs text-[#8a7e6e] mt-0.5 leading-relaxed">{t(`steps.${key}.description`)}</div>
            </div>
          </motion.div>
        ))}
      </div>
      <div className="mt-4 p-3 bg-[#f5f2ee] rounded-lg text-xs text-[#6b5e4e] leading-relaxed">
        <strong>{t('day1Banner.label')}</strong> {t('day1Banner.body')}
      </div>
    </Modal>
  )
}
