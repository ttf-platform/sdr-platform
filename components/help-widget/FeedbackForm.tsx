'use client'

import { useState } from 'react'

interface Props {
  onBack: () => void
  onClose: () => void
}

type Category = 'suggestion' | 'feature_request' | 'ux' | 'performance' | 'other'

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'feature_request', label: 'Feature request' },
  { value: 'ux', label: 'UX / Design' },
  { value: 'performance', label: 'Performance' },
  { value: 'other', label: 'Other' },
]

export function FeedbackForm({ onBack, onClose }: Props) {
  const [category, setCategory] = useState<Category>('suggestion')
  const [content, setContent] = useState('')
  const [wouldPay, setWouldPay] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!content.trim()) {
      setError('Please describe your feedback.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        category,
        content: content.trim(),
      }
      if (category === 'feature_request' && wouldPay !== null) {
        body.wouldPay = wouldPay
      }
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to submit. Please try again.')
        return
      }
      setSubmitted(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-6 py-10 text-center">
        <div className="w-14 h-14 rounded-full bg-[#eef1fd] flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 2l2.4 4.8 5.2.8-3.8 3.7.9 5.2L12 14l-4.7 2.5.9-5.2-3.8-3.7 5.2-.8L12 2z" stroke="#3b6bef" strokeWidth="1.5" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="text-base font-semibold text-[#1a1a2e] mb-1">Thanks for the feedback!</div>
        <div className="text-sm text-[#8a7e6e] mb-6">We read every submission and use it to improve Sentra.</div>
        <button
          onClick={onClose}
          className="px-5 py-2 bg-[#3b6bef] text-white rounded-xl text-sm font-medium hover:bg-[#2a5bdf] transition-colors"
        >
          Done
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#f0ece6] flex-shrink-0">
        <button onClick={onBack} className="text-[#8a7e6e] hover:text-[#1a1a2e]">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="text-sm font-semibold text-[#1a1a2e] flex-1">Give feedback</span>
        <button onClick={onClose} className="text-[#8a7e6e] hover:text-[#1a1a2e]">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Category pills */}
        <div>
          <label className="block text-xs font-medium text-[#4a4a5a] mb-2">Category</label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map(cat => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  category === cat.value
                    ? 'bg-[#3b6bef] text-white'
                    : 'bg-[#f0ece6] text-[#4a4a5a] hover:bg-[#e8e3dc]'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div>
          <label className="block text-xs font-medium text-[#4a4a5a] mb-1">
            Your feedback <span className="text-red-400">*</span>
          </label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Tell us what you think…"
            rows={4}
            maxLength={5000}
            className="w-full text-sm border border-[#e8e3dc] rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-[#3b6bef] text-[#1a1a2e] placeholder:text-[#c0bab2]"
          />
        </div>

        {/* Would-pay toggle — only for feature requests */}
        {category === 'feature_request' && (
          <div>
            <label className="block text-xs font-medium text-[#4a4a5a] mb-2">
              Would you pay for this feature?
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setWouldPay(true)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors border ${
                  wouldPay === true
                    ? 'bg-[#3b6bef] text-white border-[#3b6bef]'
                    : 'bg-white text-[#4a4a5a] border-[#e8e3dc] hover:bg-[#f7f4f0]'
                }`}
              >
                Yes
              </button>
              <button
                onClick={() => setWouldPay(false)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors border ${
                  wouldPay === false
                    ? 'bg-[#3b6bef] text-white border-[#3b6bef]'
                    : 'bg-white text-[#4a4a5a] border-[#e8e3dc] hover:bg-[#f7f4f0]'
                }`}
              >
                No
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      <div className="px-4 pb-4 pt-2 border-t border-[#f0ece6] flex-shrink-0">
        <button
          onClick={submit}
          disabled={submitting}
          className="w-full py-2.5 bg-[#3b6bef] text-white rounded-xl text-sm font-semibold hover:bg-[#2a5bdf] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Submitting…' : 'Send feedback'}
        </button>
      </div>
    </>
  )
}
