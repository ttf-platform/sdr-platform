'use client'
import { calculateProfileScore, getMissingCriteria } from '@/lib/profile-quality'
import type { ProfileForScore } from '@/lib/profile-quality'

interface Props {
  profile: ProfileForScore | null
  className?: string
}

export default function ProfileQualityBadge({ profile, className = '' }: Props) {
  if (!profile) return null
  const score   = calculateProfileScore(profile)
  const missing = getMissingCriteria(profile)

  let pillCls: string
  let label: string
  if (score >= 70) {
    pillCls = 'bg-green-50 text-green-700 border border-green-200'
    label   = `✨ Premium AI quality (${score}%)`
  } else if (score >= 30) {
    pillCls = 'bg-amber-50 text-amber-700 border border-amber-200'
    label   = `📊 Good AI quality (${score}%)`
  } else {
    pillCls = 'bg-red-50 text-red-600 border border-red-200'
    label   = `⚠️ Limited AI quality (${score}%)`
  }

  return (
    <div className={className}>
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${pillCls}`}>
        {label}
      </span>
      {missing.length > 0 && (
        <p className="text-xs text-[#8a7e6e] mt-1">
          Add to improve:{' '}
          {missing.slice(0, 3).join(', ')}
          {missing.length > 3 ? ` +${missing.length - 3} more` : ''}
        </p>
      )}
    </div>
  )
}
