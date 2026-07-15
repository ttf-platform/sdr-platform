'use client'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useWorkspace } from '@/lib/hooks/useWorkspace'

export default function TrialBadge() {
  const t = useTranslations('components.trialBadge')
  const { workspace } = useWorkspace()

  const ws = workspace?.workspaces
  if (!ws || ws.subscription_status !== 'trialing' || !ws.trial_end_date) return null

  const now = new Date()
  const end = new Date(ws.trial_end_date)
  const diffMs = end.getTime() - now.getTime()
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  const isExpired = daysLeft <= 0
  const isUrgent = daysLeft <= 3 && daysLeft > 0

  let className = ''
  let text = ''
  if (isExpired) {
    className = 'bg-red-500 text-white border-red-500'
    text = t('expired')
  } else if (isUrgent) {
    className = 'bg-red-50 text-red-700 border-red-200'
    text = t('daysLeft', { count: daysLeft })
  } else {
    className = 'bg-amber-50 text-amber-700 border-amber-200'
    text = t('daysLeft', { count: daysLeft })
  }

  return (
    <Link
      href="/dashboard/billing"
      className={"text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors whitespace-nowrap " + className}
    >
      {text}
    </Link>
  )
}
