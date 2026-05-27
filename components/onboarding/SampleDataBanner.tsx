'use client'

import { useState } from 'react'
import { useOnboardingProgress } from '@/lib/hooks/useOnboardingProgress'

export function SampleDataBanner() {
  const { data } = useOnboardingProgress()
  const [clearing, setClearing] = useState(false)

  const tryMirvoMode = data?.stored?.try_mirvo_mode === true
  if (!tryMirvoMode) return null

  async function handleClear() {
    setClearing(true)
    try {
      await fetch('/api/onboarding/clear-sample-data', { method: 'DELETE' })
      window.location.href = '/dashboard'
    } catch {
      setClearing(false)
    }
  }

  return (
    <div className="bg-[#fff8ed] border-b border-[#f5d98b] px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[#a07d2a] text-sm leading-none flex-shrink-0">⚗</span>
        <p className="text-sm text-[#7a5c1a] font-medium truncate">
          You're viewing <span className="font-semibold">sample data</span> — campaigns, prospects and signals are pre-filled for demo purposes.
        </p>
      </div>
      <button
        onClick={handleClear}
        disabled={clearing}
        className="flex-shrink-0 text-xs font-semibold text-[#7a5c1a] border border-[#e8c96a] bg-white hover:bg-[#fdf3d0] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
      >
        {clearing ? 'Clearing…' : 'Clear and start fresh →'}
      </button>
    </div>
  )
}
