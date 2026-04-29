'use client'
import { useEffect, useState } from 'react'

interface EmailDetail {
  id:         string
  subject:    string
  body:       string
  status:     string
  mode:       'fast' | 'smart'
  prospect:   { email: string; contact: { first_name?: string; last_name?: string; company?: string } | null }
  step:       { step_order: number; step_type: string }
}

interface Props {
  emailId:                    string
  campaignPersonalizationMode: 'fast' | 'smart' | null
  onClose:                    () => void
  onSaved:                    () => void
}

export function EditEmailModal({ emailId, campaignPersonalizationMode, onClose, onSaved }: Props) {
  const [email,   setEmail]   = useState<EmailDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [subject, setSubject] = useState('')
  const [body,    setBody]    = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [regenning,    setRegenning]   = useState(false)

  useEffect(() => {
    fetch(`/api/prospect-emails/${emailId}`)
      .then(r => r.json())
      .then(d => {
        if (d.email) {
          setEmail(d.email)
          setSubject(d.email.subject)
          setBody(d.email.body)
        } else {
          setError('Failed to load email.')
        }
      })
      .catch(() => setError('Failed to load email.'))
      .finally(() => setLoading(false))
  }, [emailId])

  async function handleSave(approve = false) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/prospect-emails/${emailId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ subject, body }),
      }).then(r => r.json())

      if (res.error) { setError(res.error); setSaving(false); return }

      if (approve) {
        await fetch(`/api/prospect-emails/${emailId}/approve`, { method: 'POST' })
      }

      onSaved()
    } catch {
      setError('Save failed. Please try again.')
      setSaving(false)
    }
  }

  async function handleRegenerate() {
    setConfirmRegen(false)
    setRegenning(true)
    setError('')
    try {
      const res = await fetch(`/api/prospect-emails/${emailId}/regenerate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mode: campaignPersonalizationMode ?? 'fast' }),
      }).then(r => r.json())

      if (res.error) { setError(res.error); setRegenning(false); return }
      if (res.email) {
        setEmail(res.email)
        setSubject(res.email.subject)
        setBody(res.email.body)
      }
    } catch {
      setError('Regeneration failed. Please try again.')
    } finally {
      setRegenning(false)
    }
  }

  const isSmartStep0 =
    (email?.mode === 'smart' || campaignPersonalizationMode === 'smart') &&
    email?.step.step_order === 0

  const prospectLabel = (() => {
    if (!email) return ''
    const c = email.prospect.contact
    const name = c ? [c.first_name, c.last_name].filter(Boolean).join(' ') : ''
    return name || email.prospect.email
  })()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget && !saving && !regenning) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#f0ece6] shrink-0">
          <div>
            <h2 className="text-base font-bold text-[#1a1a2e]">Edit draft</h2>
            {prospectLabel && <p className="text-xs text-[#8a7e6e] mt-0.5">{prospectLabel}</p>}
          </div>
          <button
            onClick={onClose}
            disabled={saving || regenning}
            className="text-[#8a7e6e] hover:text-[#1a1a2e] text-xl leading-none disabled:opacity-40">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
          {loading ? (
            <div className="text-sm text-[#8a7e6e] text-center py-8">Loading…</div>
          ) : error && !email ? (
            <div className="text-sm text-red-600 text-center py-8">{error}</div>
          ) : (
            <>
              {isSmartStep0 && (
                <div className="flex items-center gap-2 text-xs text-[#3b6bef] bg-[#eef1fd] rounded-lg px-3 py-2">
                  <span>✨</span>
                  <span>This email was personalized by Sentra AI</span>
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[#6b5e4e]">Subject</label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  disabled={saving || regenning}
                  className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm text-[#1a1a2e] focus:outline-none focus:border-[#3b6bef] disabled:opacity-60"
                />
              </div>

              <div className="flex flex-col gap-1 flex-1">
                <label className="text-xs font-medium text-[#6b5e4e]">Body</label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  disabled={saving || regenning}
                  rows={14}
                  className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm text-[#1a1a2e] focus:outline-none focus:border-[#3b6bef] resize-none disabled:opacity-60 font-mono"
                />
              </div>

              <div className="flex justify-start">
                <button
                  onClick={() => setConfirmRegen(true)}
                  disabled={saving || regenning}
                  className="text-xs text-[#3b6bef] hover:underline disabled:opacity-40">
                  {regenning ? 'Regenerating…' : '↺ Regenerate this email'}
                </button>
              </div>

              {error && <p className="text-xs text-red-600">{error}</p>}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && email && (
          <div className="flex gap-2 p-5 border-t border-[#f0ece6] shrink-0">
            <button
              onClick={onClose}
              disabled={saving || regenning}
              className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm disabled:opacity-40">
              Cancel
            </button>
            <button
              onClick={() => handleSave(false)}
              disabled={saving || regenning}
              className="flex-1 border border-[#3b6bef] text-[#3b6bef] rounded-lg py-2 text-sm font-medium disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={saving || regenning}
              className="flex-1 bg-[#3b6bef] text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40">
              {saving ? 'Saving…' : 'Save & approve'}
            </button>
          </div>
        )}
      </div>

      {/* Regenerate confirmation */}
      {confirmRegen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-base font-bold text-[#1a1a2e] mb-2">Regenerate email?</h3>
            <p className="text-sm text-[#6b5e4e] mb-5">
              This will overwrite your edits. Continue?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmRegen(false)}
                className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm">
                Cancel
              </button>
              <button
                onClick={handleRegenerate}
                className="flex-1 bg-[#3b6bef] text-white rounded-lg py-2 text-sm font-semibold">
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
