'use client'
import { useEffect, useState, useRef } from 'react'
import { insertBookingUrl, stripBookingUrl } from '@/lib/normalize-body'
import { renderSignature, appendSignature, stripSignature } from '@/lib/signature'

interface EmailDetail {
  id:         string
  subject:    string
  body:       string
  status:     string
  mode:       'fast' | 'smart'
  step_order: number | null
  step_type:  string | null
  prospect:   {
    email:      string | null
    first_name: string | null
    last_name:  string | null
    company:    string | null
  }
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
  const [confirmRegen,       setConfirmRegen]       = useState(false)
  const [regenning,          setRegenning]          = useState(false)
  const [bookingSlug,        setBookingSlug]        = useState<string | null>(null)
  const [includeBookingLink, setIncludeBookingLink] = useState(false)
  const [includeSignature,   setIncludeSignature]   = useState(false)
  const [sigLoaded,          setSigLoaded]          = useState(false)
  const bookingUrlRef  = useRef<string | null>(null)
  const signatureRef   = useRef<string>('')
  const workspaceIdRef = useRef<string | null>(null)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mirvo.ai'

  useEffect(() => {
    fetch('/api/workspace-profile')
      .then(r => r.json())
      .then(d => {
        if (!d.profile) return
        if (d.profile.booking_slug) setBookingSlug(d.profile.booking_slug)
        workspaceIdRef.current = d.profile.workspace_id
        const rendered = renderSignature(d.profile.email_signature ?? null, {
          user_name:       d.profile.user_name      ?? '',
          user_title:      d.profile.user_title     ?? '',
          company:         d.profile.company_name   ?? '',
          company_website: d.profile.company_website ?? '',
        })
        signatureRef.current = rendered
        setSigLoaded(true)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setConfirmRegen(false)
    setLoading(true)
    setError('')
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

  // Detect booking link toggle state — don't re-order body (preserve DB-stored order)
  useEffect(() => {
    if (!email || !bookingSlug) return
    const url = `${appUrl}/book/${bookingSlug}`
    bookingUrlRef.current = url
    setIncludeBookingLink(email.body.includes(url))
  }, [email, bookingSlug, appUrl])

  // Detect signature in body once both email and signature are loaded
  useEffect(() => {
    if (!email || !sigLoaded) return
    const sig = signatureRef.current
    if (!sig) { setIncludeSignature(false); return }
    setIncludeSignature(email.body.trimEnd().endsWith(sig.trimEnd()))
  }, [email, sigLoaded])

  function toggleBookingLink(checked: boolean) {
    const url = bookingUrlRef.current
    setIncludeBookingLink(checked)
    if (!url) return
    if (checked) {
      setBody(b => insertBookingUrl(b, url, includeSignature ? signatureRef.current : ''))
    } else {
      setBody(b => stripBookingUrl(b, url))
    }
  }

  function toggleSignature(checked: boolean) {
    const sig = signatureRef.current
    setIncludeSignature(checked)
    if (sig) setBody(b => checked ? appendSignature(b, sig) : stripSignature(b, sig))
    if (workspaceIdRef.current) {
      fetch('/api/workspace/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceIdRef.current, signature_in_initial: checked }),
      }).catch(() => {})
    }
  }

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
        setSubject(res.email.subject)

        // Re-apply current toggle states to regenerated body.
        // Do NOT call setEmail — that would re-trigger detection effects
        // which would reset toggles based on the bare regenerated body.
        let newBody = res.email.body
        const url = bookingUrlRef.current
        const sig = signatureRef.current
        if (includeBookingLink && url) {
          newBody = insertBookingUrl(newBody, url, includeSignature && sig ? sig : '')
        }
        if (includeSignature && sig) {
          newBody = appendSignature(newBody, sig)
        }
        setBody(newBody)
      }
    } catch {
      setError('Regeneration failed. Please try again.')
    } finally {
      setRegenning(false)
    }
  }

  const isSmartStep0 =
    (email?.mode === 'smart' || campaignPersonalizationMode === 'smart') &&
    email?.step_order === 0

  const prospectLabel = (() => {
    if (!email) return ''
    const name = [email.prospect.first_name, email.prospect.last_name].filter(Boolean).join(' ')
    return name || email.prospect.email || ''
  })()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget && !saving && !regenning) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[calc(100vh-2rem)]">

        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-[#f0ece6] shrink-0">
          <div>
            <h2 className="text-base font-bold text-[#1a1a2e]">Edit draft</h2>
            {prospectLabel && <p className="text-xs text-[#8a7e6e] mt-0.5">{prospectLabel}</p>}
          </div>
          <button
            onClick={onClose}
            disabled={saving || regenning}
            className="p-2 text-[#8a7e6e] hover:text-[#1a1a2e] text-xl leading-none disabled:opacity-40">
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
                  <span>This email was personalized by Mirvo AI</span>
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
                  rows={12}
                  className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm text-[#1a1a2e] focus:outline-none focus:border-[#3b6bef] resize-none disabled:opacity-60 font-mono"
                />
              </div>

              {/* Booking link toggle */}
              {bookingSlug && (
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeBookingLink}
                      onChange={e => toggleBookingLink(e.target.checked)}
                      disabled={saving || regenning}
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

              {/* Signature toggle */}
              {sigLoaded && signatureRef.current && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeSignature}
                    onChange={e => toggleSignature(e.target.checked)}
                    disabled={saving || regenning}
                    className="rounded border-[#e8e3dc] text-[#3b6bef] disabled:opacity-60"
                  />
                  <span className="text-xs text-[#6b5e4e]">✍️ Include email signature</span>
                </label>
              )}

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
