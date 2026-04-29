'use client'
import { useEffect, useState } from 'react'

export interface FollowUpStep {
  id: string
  step_order: number
  delay_days: number
  subject: string | null
  body: string
  include_booking_link: boolean
}

interface Props {
  step: FollowUpStep
  followUpNumber: number
  campaignId: string
  onClose: () => void
  onSaved: (step: FollowUpStep) => void
}

export function EditFollowUpModal({ step, followUpNumber, campaignId, onClose, onSaved }: Props) {
  const [subject,            setSubject]            = useState(step.subject ?? '')
  const [body,               setBody]               = useState(step.body)
  const [delayDays,          setDelayDays]          = useState(step.delay_days)
  const [includeBookingLink, setIncludeBookingLink] = useState(step.include_booking_link)
  const [bookingSlug,        setBookingSlug]        = useState<string | null>(null)
  const [saving,             setSaving]             = useState(false)
  const [aiWriting,          setAiWriting]          = useState(false)
  const [error,              setError]              = useState('')

  useEffect(() => {
    fetch('/api/workspace-profile')
      .then(r => r.json())
      .then(d => { if (d.profile?.booking_slug) setBookingSlug(d.profile.booking_slug) })
      .catch(() => {})
  }, [])

  const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? 'https://sentra.app'
  const bookingUrl = bookingSlug ? `${appUrl}/book/${bookingSlug}` : null

  async function handleAiWrite() {
    setAiWriting(true)
    setError('')
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/steps/${step.id}/ai-write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).then(r => r.json())
      if (res.error) { setError(res.error); return }
      if (res.step) {
        setSubject(res.step.subject ?? '')
        setBody(res.step.body ?? '')
      }
    } catch {
      setError('AI generation failed. Please try again.')
    } finally {
      setAiWriting(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/steps/${step.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject:              subject.trim() || null,
          body,
          delay_days:           delayDays,
          include_booking_link: includeBookingLink,
        }),
      }).then(r => r.json())
      if (res.error) { setError(res.error); setSaving(false); return }
      onSaved(res.step)
    } catch {
      setError('Save failed. Please try again.')
      setSaving(false)
    }
  }

  const inputCls = 'w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget && !saving && !aiWriting) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl mx-4 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#f0ece6] shrink-0">
          <h2 className="text-base font-bold text-[#1a1a2e]">Edit Follow-up #{followUpNumber}</h2>
          <button
            onClick={onClose}
            disabled={saving || aiWriting}
            className="text-[#8a7e6e] hover:text-[#1a1a2e] text-xl leading-none disabled:opacity-40">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">

          {/* Delay */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-[#4a4a5a] uppercase tracking-wider shrink-0">
              Send after
            </label>
            <input
              type="number" min={1} max={60}
              value={delayDays}
              onChange={e => setDelayDays(parseInt(e.target.value) || 1)}
              disabled={saving || aiWriting}
              className="w-20 border border-[#e8e3dc] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#3b6bef] disabled:opacity-60"
            />
            <span className="text-xs text-[#6b5e4e]">days of no reply</span>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-semibold text-[#4a4a5a] uppercase tracking-wider mb-1.5">
              Subject line
            </label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              disabled={saving || aiWriting}
              placeholder="Leave blank to thread reply on previous email"
              className={`${inputCls} disabled:opacity-60`}
            />
          </div>

          {/* Body */}
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs font-semibold text-[#4a4a5a] uppercase tracking-wider">Body</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              disabled={saving || aiWriting}
              rows={10}
              className={`${inputCls} resize-none font-mono text-xs leading-relaxed disabled:opacity-60`}
              placeholder="Follow-up email body…"
            />
          </div>

          {/* Booking link */}
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeBookingLink}
                onChange={e => setIncludeBookingLink(e.target.checked)}
                disabled={saving || aiWriting}
                className="rounded border-[#e8e3dc] text-[#3b6bef] disabled:opacity-60"
              />
              <span className="text-xs text-[#6b5e4e]">📅 Include calendar booking link in this follow-up</span>
            </label>
            {includeBookingLink && (
              bookingUrl
                ? <p className="text-xs text-[#8a7e6e] pl-5">
                    The booking link will be replaced at send time: <span className="text-[#3b6bef]">{bookingUrl}</span>
                  </p>
                : <p className="text-xs text-amber-600 pl-5">
                    No booking page configured. <a href="/dashboard/settings" className="underline">Set it up in Settings</a> to activate this link.
                  </p>
            )}
          </div>

          {/* AI Write */}
          <div>
            <button
              onClick={handleAiWrite}
              disabled={saving || aiWriting}
              className="flex items-center gap-1.5 text-xs text-[#3b6bef] font-medium border border-[#dde6fd] bg-[#f7f8ff] hover:bg-[#eef1fd] px-3 py-1.5 rounded-lg disabled:opacity-40 transition-colors">
              {aiWriting
                ? <span className="w-3 h-3 border border-[#3b6bef]/30 border-t-[#3b6bef] rounded-full animate-spin" />
                : '✨'} {aiWriting ? 'Writing…' : 'AI Write'}
            </button>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-5 border-t border-[#f0ece6] shrink-0">
          <button
            onClick={onClose}
            disabled={saving || aiWriting}
            className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm disabled:opacity-40">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || aiWriting}
            className="flex-1 bg-[#3b6bef] hover:bg-[#2a5bdf] text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40 transition-colors">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
