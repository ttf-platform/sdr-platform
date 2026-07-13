'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'

const supabase = createClient()

interface Props {
  isOpen: boolean
  onClose: () => void
}

export function ChangePasswordModal({ isOpen, onClose }: Props) {
  const t = useTranslations('dashboard.settings.password')
  const tDanger = useTranslations('dashboard.settings.danger')
  const tCommon = useTranslations('dashboard.common')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setPassword('')
    setConfirm('')
    setError(null)
    setSubmitting(false)
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError(t('tooShort')); return }
    if (password !== confirm) { setError(t('mismatch')); return }
    setSubmitting(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (err) { setError(err.message); return }
    toast.success(t('success'))
    close()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={tDanger('changePassword')}
      size="sm"
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
            form="change-password-form"
            disabled={submitting || password.length < 8 || password !== confirm}
            className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-40"
          >
            {submitting ? t('submitting') : t('submit')}
          </button>
        </>
      }
    >
      <form id="change-password-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
        {error && (
          <div role="alert" className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>
        )}
        <div>
          <label htmlFor="cp-password" className="text-xs font-bold text-[#6b5e4e] mb-1 block">{t('newLabel')}</label>
          <input
            id="cp-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
            required
            minLength={8}
          />
        </div>
        <div>
          <label htmlFor="cp-confirm" className="text-xs font-bold text-[#6b5e4e] mb-1 block">{t('confirmLabel')}</label>
          <input
            id="cp-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
            required
            minLength={8}
          />
        </div>
      </form>
    </Modal>
  )
}
