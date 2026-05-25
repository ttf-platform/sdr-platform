'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'

type Variant = {
  id: string
  subject: string
  body: string
  edited_subject: string | null
  edited_body: string | null
  status: string
}

type VariantEditModalProps = {
  isOpen: boolean
  onClose: () => void
  variant: Variant
  onSaved: () => void
}

export function VariantEditModal({ isOpen, onClose, variant, onSaved }: VariantEditModalProps) {
  const initialSubject = variant.status === 'edited'
    ? (variant.edited_subject ?? variant.subject)
    : variant.subject
  const initialBody = variant.status === 'edited'
    ? (variant.edited_body ?? variant.body)
    : variant.body

  const [subject, setSubject] = useState(initialSubject)
  const [body, setBody] = useState(initialBody)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!subject.trim() || !body.trim()) {
      setError('Subject and body are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/prospect-email-variants/${variant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit',
          edited_subject: subject,
          edited_body: body,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data?.error ?? 'Save failed')
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit personalized email" size="lg">
      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-xs font-semibold text-[#1a1a2e] mb-1">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef]"
            maxLength={200}
          />
          <p className="text-xs text-[#8a7e6e] mt-1">{subject.length}/200</p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#1a1a2e] mb-1">Body</label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={12}
            className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:border-[#3b6bef] resize-none"
            maxLength={5000}
          />
          <p className="text-xs text-[#8a7e6e] mt-1">{body.length}/5000</p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2 text-sm hover:bg-[#f7f4f0] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !subject.trim() || !body.trim()}
            className="bg-[#3b6bef] text-white rounded-lg px-4 py-2 text-sm hover:bg-[#2d5cdc] transition-colors disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save edits'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
