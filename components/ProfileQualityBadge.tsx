'use client'
import { calculateProfileScore } from '@/lib/profile-quality'
import type { ProfileForScore } from '@/lib/profile-quality'

interface Props {
  profile: ProfileForScore | null
  className?: string
}

export default function ProfileQualityBadge({ profile, className = '' }: Props) {
  if (!profile) return null
  const score = calculateProfileScore(profile)

  let pillCls: string
  let label: string
  let subtext: string
  if (score >= 70) {
    pillCls = 'bg-green-50 text-green-700 border border-green-200'
    label   = `✨ Full context (${score}%)`
    subtext = 'Your AI knows your business inside out. Expect tailored, on-voice outputs.'
  } else if (score >= 30) {
    pillCls = 'bg-amber-50 text-amber-700 border border-amber-200'
    label   = `📊 Decent context (${score}%)`
    subtext = 'Your AI works, but better data = sharper outputs. Add more details to level up.'
  } else {
    pillCls = 'bg-red-50 text-red-600 border border-red-200'
    label   = `⚠️ Limited context (${score}%)`
    subtext = 'Your AI outputs will be generic. Complete your profile to get specific, on-brand results.'
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${pillCls}`}>
        {label}
      </span>
      <span className="text-xs text-[#8a7e6e]">{subtext}</span>
    </div>
  )
}
