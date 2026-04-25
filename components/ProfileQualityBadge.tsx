'use client'
import { calculateProfileScore } from '@/lib/profile-quality'
import type { ProfileForScore } from '@/lib/profile-quality'

interface Props {
  profile: ProfileForScore | null
  hideEditLink?: boolean
  className?: string
}

export default function ProfileQualityBadge({ profile, hideEditLink = false, className = '' }: Props) {
  if (!profile) return null
  const score = calculateProfileScore(profile)

  let bannerCls: string
  let pillCls: string
  let label: string
  let subtext: string

  if (score >= 70) {
    bannerCls = 'bg-emerald-50 border-l-4 border-emerald-500'
    pillCls   = 'bg-emerald-100 text-emerald-700'
    label     = `✨ Full context · ${score}%`
    subtext   = 'Your AI knows your business inside out. Expect tailored, on-voice outputs.'
  } else if (score >= 30) {
    bannerCls = 'bg-amber-50 border-l-4 border-amber-500'
    pillCls   = 'bg-amber-100 text-amber-700'
    label     = `📊 Decent context · ${score}%`
    subtext   = 'Your AI works, but better data = sharper outputs. Add more details to level up.'
  } else {
    bannerCls = 'bg-red-50 border-l-4 border-red-500'
    pillCls   = 'bg-red-100 text-red-700'
    label     = `⚠️ Limited context · ${score}%`
    subtext   = 'Your AI outputs will be generic. Complete your profile to get specific, on-brand results.'
  }

  return (
    <div className={`flex items-center gap-4 px-4 py-3 rounded-r-lg ${bannerCls} ${className}`}>
      <span className={`whitespace-nowrap text-xs font-semibold px-2.5 py-1 rounded-full ${pillCls}`}>
        {label}
      </span>
      <span className="flex-1 text-sm text-[#6b5e4e] truncate min-w-0">{subtext}</span>
      {!hideEditLink && (
        <a href="/dashboard/settings" className="whitespace-nowrap text-xs font-semibold text-[#3b6bef] hover:underline flex-shrink-0">
          Edit profile →
        </a>
      )}
    </div>
  )
}
