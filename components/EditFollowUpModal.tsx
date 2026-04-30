'use client'
import { useEffect, useRef, useState } from 'react'
import { normalizeBody } from '@/lib/normalize-body'

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
  const [delay,              setDelay]              = useState(step.delay_days)
  const [subject,            setSubject]            = useState(step.subject ?? '')
  const [body,               setBody]               = useState(step.body)
  const [includeBookingLink, setIncludeBookingLink] = useState(step.include_booking_link)
  const [saving,             setSaving]             = useState(false)
  const [bookingSlug,        setBookingSlug]        = useState<string | null>(null)
  const bookingUrlRef = useRef<string | null>(null)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://sentra.app'

  useEffect(() => {
    fetch('/api/workspace-profile')
      .then(r => r.json())
      .then(d => { if (d.profile?.booking_slug) setBookingSlug(d.profile.booking_slug) })
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#f0ece6] shrink-0">
          <h2 className="text-base font-bold text-[#1a1a2e]">Edit follow-up</h2>
          <button onClick={onClose} disabled={saving}
            className="text-[#8a7e6e] hover:text-[#1a1a2e] text-xl leading-none disabled:opacity-40">✕</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">

          {/* Delay */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#6b5e4e]">Send after (days of no reply)</label>
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
              Subject <span className="text-[#a89e8e] font-normal">(leave blank to thread reply)</span>
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
            <label className="text-xs font-medium text-[#6b5e4e]">Body</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              disabled={saving}
              rows={10}
              className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm text-[#1a1a2e] focus:outline-none focus:border-[#3b6bef] resize-none disabled:opacity-60 font-mono"
            />
          </div>

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
                <span className="text-xs text-[#6b5e4e]">📅 Include calendar booking link</span>
              </label>
              {includeBookingLink && (
                <p className="text-xs text-[#a89e8e] pl-5">
                  Preview: <span className="text-[#3b6bef]">{`${appUrl}/book/${bookingSlug}`}</span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-5 border-t border-[#f0ece6] shrink-0">
          <button onClick={onClose} disabled={saving}
            className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm disabled:opacity-40">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-[#3b6bef] text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
