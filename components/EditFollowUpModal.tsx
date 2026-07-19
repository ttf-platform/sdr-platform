'use client'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { normalizeBody } from '@/lib/normalize-body'
import { AttachmentPicker } from '@/components/AttachmentPicker'

interface FollowupStep {
  id:                   string
  delay_days:           number
  subject:              string | null
  body:                 string
  include_booking_link: boolean
}

interface Props {
  step:    FollowupStep
  onSave:  (updated: { delay_days: number; subject: string | null; body: string; include_booking_link: boolean }) => Promise<void>
  onClose: () => void
}

export function EditFollowupModal({ step, onSave, onClose }: Props) {
  const t = useTranslations('components.emailModals.editFollowUp')
  const tCommon = useTranslations('components.emailModals.common')
  const [delay,              setDelay]              = useState(step.delay_days)
  const [subject,            setSubject]            = useState(step.subject ?? '')
  const [body,               setBody]               = useState(step.body)
  const [includeBookingLink, setIncludeBookingLink] = useState(step.include_booking_link)
  const [includeSignature,   setIncludeSignature]   = useState<boolean | null>(null)
  const [saving,             setSaving]             = useState(false)
  const [bookingSlug,        setBookingSlug]        = useState<string | null>(null)
  const bookingUrlRef  = useRef<string | null>(null)
  const workspaceIdRef = useRef<string | null>(null)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'

  useEffect(() => {
    fetch('/api/workspace-profile')
      .then(r => r.json())
      .then(d => {
        if (!d.profile) return
        if (d.profile.booking_slug) setBookingSlug(d.profile.booking_slug)
        workspaceIdRef.current = d.profile.workspace_id
        setIncludeSignature(d.profile.signature_in_followups ?? false)
      })
      .catch(() => {})
  }, [])

  // Normalize body once booking slug is known
  useEffect(() => {
    if (!bookingSlug) return
    const url = `${appUrl}/book/${bookingSlug}`
    bookingUrlRef.current = url
    setIncludeBookingLink(step.include_booking_link)
    setBody(normalizeBody(step.body, step.include_booking_link, url))
  }, [bookingSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleBookingLink(checked: boolean) {
    const url = bookingUrlRef.current
    setIncludeBookingLink(checked)
    if (!url) return
    setBody(b => normalizeBody(b, checked, url))
  }

  function toggleSignature(checked: boolean) {
    setIncludeSignature(checked)
    if (workspaceIdRef.current) {
      fetch('/api/workspace/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceIdRef.current, signature_in_followups: checked }),
      }).catch(() => {})
    }
  }

  async function handleSave() {
    setSaving(true)
    await onSave({
      delay_days:           delay,
      subject:              subject.trim() || null,
      body,
      include_booking_link: includeBookingLink,
    })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[calc(100vh-2rem)]">

        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-[#f0ece6] shrink-0">
          <h2 className="text-base font-bold text-[#1a1a2e]">{t('title')}</h2>
          <button onClick={onClose} disabled={saving}
            className="p-2 text-[#8a7e6e] hover:text-[#1a1a2e] text-xl leading-none disabled:opacity-40">✕</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">

          {/* Delay */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#6b5e4e]">{t('delayLabel')}</label>
            <input
              type="number" min={1} max={60}
              value={delay}
              onChange={e => setDelay(parseInt(e.target.value) || 1)}
              disabled={saving}
              className="w-24 border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:border-[#3b6bef] disabled:opacity-60"
            />
          </div>

          {/* Subject */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#6b5e4e]">
              {t.rich('subjectHint', {
                hint: (chunks) => <span className="text-[#a89e8e] font-normal">{chunks}</span>,
              })}
            </label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              disabled={saving}
              className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm text-[#1a1a2e] focus:outline-none focus:border-[#3b6bef] disabled:opacity-60"
            />
          </div>

          {/* Body */}
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs font-medium text-[#6b5e4e]">{tCommon('bodyLabel')}</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              disabled={saving}
              rows={8}
              className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm text-[#1a1a2e] focus:outline-none focus:border-[#3b6bef] resize-none disabled:opacity-60 font-mono"
            />
          </div>

          {/* Attachment picker — follow-up step, jamais first-touch.
              signature='' : la signature n'est pas composée dans le body
              côté follow-up (rendue server-side au send). */}
          <AttachmentPicker
            body={body}
            setBody={setBody}
            signature=""
            isFirstTouch={false}
            disabled={saving}
          />

          {/* Booking link */}
          {bookingSlug && (
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeBookingLink}
                  onChange={e => toggleBookingLink(e.target.checked)}
                  disabled={saving}
                  className="rounded border-[#e8e3dc] text-[#3b6bef] disabled:opacity-60"
                />
                <span className="text-xs text-[#6b5e4e]">{tCommon('includeBookingLink')}</span>
              </label>
              {includeBookingLink && (
                <p className="text-xs text-[#a89e8e] pl-5">
                  {tCommon('preview')} <span className="text-[#3b6bef]">{`${appUrl}/book/${bookingSlug}`}</span>
                </p>
              )}
            </div>
          )}

          {/* Signature toggle */}
          {includeSignature !== null && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeSignature}
                onChange={e => toggleSignature(e.target.checked)}
                disabled={saving}
                className="rounded border-[#e8e3dc] text-[#3b6bef] disabled:opacity-60"
              />
              <span className="text-xs text-[#6b5e4e]">{t('includeSignature')}</span>
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-5 border-t border-[#f0ece6] shrink-0">
          <button onClick={onClose} disabled={saving}
            className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm disabled:opacity-40">
            {tCommon('cancel')}
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-[#3b6bef] text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40">
            {saving ? tCommon('saving') : tCommon('save')}
          </button>
        </div>
      </div>
    </div>
  )
}
