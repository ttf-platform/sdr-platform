'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'

const supabase = createClient()

interface Props {
  isOpen:  boolean
  onClose: () => void
  email:   string | null | undefined
}

export function DeleteAccountModal({ isOpen, onClose, email }: Props) {
  const t = useTranslations('dashboard.settings.deleteAccount')
  const tDanger = useTranslations('dashboard.settings.danger')
  const tCommon = useTranslations('dashboard.common')

  const [typed, setTyped] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const expected = (email ?? '').trim().toLowerCase()
  const provided = typed.trim().toLowerCase()
  const matches  = expected.length > 0 && provided === expected

  function close() {
    setTyped('')
    setError(null)
    setSubmitting(false)
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!matches) { setError(t('confirmMismatch')); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' })
      if (!res.ok) {
        setSubmitting(false)
        setError(t('error'))
        return
      }
      toast.success(t('success'))
      await supabase.auth.signOut()
      window.location.href = '/login'
    } catch {
      setSubmitting(false)
      setError(t('error'))
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={tDanger('deleteAccount')}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={close}
            disabled={submitting}
            className="text-sm border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-[#6b5e4e] hover:bg-[#f5f2ee] disabled:opacity-40"
          >
            {tCommon('cancel')}
          </button>
          <button
            type="submit"
            form="delete-account-form"
            disabled={submitting || !matches}
            className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-40 hover:bg-red-700"
          >
            {submitting ? t('submitting') : t('submit')}
          </button>
        </>
      }
    >
      <form id="delete-account-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm p-3 rounded-lg">
          {t('warning')}
        </div>
        <div className="text-xs text-[#6b5e4e] bg-[#faf8f5] border border-[#e8e3dc] rounded-lg p-3 space-y-1.5">
          <p>{t('gracePeriodNotice')}</p>
          <p>{t('subscriptionNotice')}</p>
        </div>
        {error && (
          <div role="alert" className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>
        )}
        <div>
          <label htmlFor="del-confirm" className="text-xs font-bold text-[#6b5e4e] mb-1 block">
            {t('confirmLabel')}
          </label>
          <input
            id="del-confirm"
            type="email"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={typed}
            onChange={e => setTyped(e.target.value)}
            className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500"
            required
          />
        </div>
      </form>
    </Modal>
  )
}
