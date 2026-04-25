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
    label   = `✨ Premium AI quality (${score}%)`
    subtext = 'Your AI outputs will be highly tailored.'
  } else if (score >= 30) {
    pillCls = 'bg-amber-50 text-amber-700 border border-amber-200'
    label   = `📊 Good AI quality (${score}%)`
    subtext = 'Fill more fields to reach Premium.'
  } else {
    pillCls = 'bg-red-50 text-red-600 border border-red-200'
    label   = `⚠️ Limited AI quality (${score}%)`
    subtext = 'Complete your profile to unlock better outputs.'
  }

  return (
    <div className={className}>
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${pillCls}`}>
        {label}
      </span>
      <span className="text-xs text-[#8a7e6e] ml-2">{subtext}</span>
    </div>
  )
}
