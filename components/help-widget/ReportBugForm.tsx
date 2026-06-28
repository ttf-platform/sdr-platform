'use client'

import { useState } from 'react'

interface Props {
  onBack: () => void
  onClose: () => void
}

export function ReportBugForm({ onBack, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [stepsToReproduce, setStepsToReproduce] = useState('')
  const [expectedBehavior, setExpectedBehavior] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!title.trim() || !description.trim()) {
      setError('Title and description are required.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          stepsToReproduce: stepsToReproduce.trim() || undefined,
          expectedBehavior: expectedBehavior.trim() || undefined,
          browser: navigator.userAgent,
          pageUrl: window.location.href,
        }),
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
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M5 12l5 5L19 7" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="text-base font-semibold text-[#1a1a2e] mb-1">Bug reported!</div>
        <div className="text-sm text-[#8a7e6e] mb-6">We&apos;ll investigate and follow up if we need more details.</div>
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
        <span className="text-sm font-semibold text-[#1a1a2e] flex-1">Report a bug</span>
        <button onClick={onClose} className="text-[#8a7e6e] hover:text-[#1a1a2e]">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-[#4a4a5a] mb-1">
            Title <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Short summary of the bug"
            maxLength={200}
            className="w-full text-sm border border-[#e8e3dc] rounded-xl px-3 py-2 focus:outline-none focus:border-[#3b6bef] text-[#1a1a2e] placeholder:text-[#c0bab2]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#4a4a5a] mb-1">
            Description <span className="text-red-400">*</span>
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What happened?"
            rows={3}
            maxLength={5000}
            className="w-full text-sm border border-[#e8e3dc] rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-[#3b6bef] text-[#1a1a2e] placeholder:text-[#c0bab2]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#4a4a5a] mb-1">Steps to reproduce</label>
          <textarea
            value={stepsToReproduce}
            onChange={e => setStepsToReproduce(e.target.value)}
            placeholder="1. Go to…&#10;2. Click on…&#10;3. See error"
            rows={3}
            className="w-full text-sm border border-[#e8e3dc] rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-[#3b6bef] text-[#1a1a2e] placeholder:text-[#c0bab2]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#4a4a5a] mb-1">Expected behavior</label>
          <textarea
            value={expectedBehavior}
            onChange={e => setExpectedBehavior(e.target.value)}
            placeholder="What should have happened?"
            rows={2}
            className="w-full text-sm border border-[#e8e3dc] rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-[#3b6bef] text-[#1a1a2e] placeholder:text-[#c0bab2]"
          />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      <div className="px-4 pb-4 pt-2 border-t border-[#f0ece6] flex-shrink-0">
        <button
          onClick={submit}
          disabled={submitting}
          className="w-full py-2.5 bg-[#3b6bef] text-white rounded-xl text-sm font-semibold hover:bg-[#2a5bdf] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Submitting…' : 'Submit bug report'}
        </button>
      </div>
    </>
  )
}
