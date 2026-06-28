'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { calculateProfileScore, getMissingCriteriaDetailed } from '@/lib/profile-quality'
import type { ProfileForScore } from '@/lib/profile-quality'

const DISMISS_KEY = 'pqs_dismissed'

interface Props {
  profile:      ProfileForScore | null
  hideEditLink?: boolean
  className?:   string
  sticky?:      boolean
  dismissible?: boolean
}

export default function ProfileQualityBadge({
  profile,
  hideEditLink = false,
  className = '',
  sticky = false,
  dismissible = false,
}: Props) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (dismissible && typeof window !== 'undefined') {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
    }
  }, [dismissible])

  if (!profile) return null
  const score   = calculateProfileScore(profile)
  const missing = getMissingCriteriaDetailed(profile)

  if (dismissed && score >= 30) return null
  if (sticky && score >= 100) return null

  let bannerCls: string
  let pillCls: string
  let label: string
  let subtext: string

  if (score >= 70) {
    bannerCls = 'bg-emerald-50 border border-emerald-200'
    pillCls   = 'bg-emerald-100 text-emerald-700'
    label     = `✨ Full context · ${score}%`
    subtext   = 'Your AI knows your business inside out. Expect tailored, on-voice outputs.'
  } else if (score >= 30) {
    bannerCls = 'bg-amber-50 border border-amber-200'
    pillCls   = 'bg-amber-100 text-amber-700'
    label     = `📊 Decent context · ${score}%`
    subtext   = 'Your AI works, but better data means sharper outputs.'
  } else {
    bannerCls = 'bg-red-50 border border-red-200'
    pillCls   = 'bg-red-100 text-red-700'
    label     = `⚠️ Limited context · ${score}%`
    subtext   = 'Campaigns are locked until you reach 30%. Complete your profile so Mirvo AI can write on-brand emails.'
  }

  function handleDismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  const stickyClass = sticky ? 'sticky top-12 z-30' : ''

  return (
    <div className={`px-4 py-3 rounded-r-lg ${bannerCls} ${stickyClass} ${className}`}>
      <div className="flex items-center gap-4">
        <span className={`whitespace-nowrap text-xs font-semibold px-2.5 py-1 rounded-full ${pillCls}`}>
          {label}
        </span>
        <span className="flex-1 text-sm text-[#6b5e4e] min-w-0 leading-snug">{subtext}</span>
        {!hideEditLink && (
          <Link
            href="/dashboard/settings"
            className="whitespace-nowrap text-xs font-semibold text-[#3b6bef] hover:underline flex-shrink-0"
            aria-label="Edit profile"
          >
            Edit profile →
          </Link>
        )}
        {dismissible && score >= 30 && (
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 text-[#9c8b7d] hover:text-[#6b5e4e] text-lg leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>

      {missing.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {missing.map(c => (
            <a
              key={c.key}
              href={c.href}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-white border border-[#e8e3dc] text-[#2563eb] hover:bg-[#2563eb] hover:text-white hover:border-[#2563eb] transition-colors"
            >
              {c.label}
              <span className="opacity-60">+{c.points}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
