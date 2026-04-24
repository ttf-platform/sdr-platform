'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const supabase = createClient()

export default function TrialBadge() {
  const [trial, setTrial] = useState<{ endDate: string; status: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session || cancelled) return
        const { data: member } = await supabase
          .from('workspace_members')
          .select('workspace_id')
          .eq('user_id', session.user.id)
          .maybeSingle()
        if (!member || cancelled) return
        const { data: ws } = await supabase
          .from('workspaces')
          .select('trial_end_date, subscription_status')
          .eq('id', member.workspace_id)
          .maybeSingle()
        if (cancelled) return
        if (ws && ws.subscription_status === 'trialing' && ws.trial_end_date) {
          setTrial({ endDate: ws.trial_end_date, status: ws.subscription_status })
        }
      } catch (e) {
        // silent fail — badge just doesn't show
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!trial) return null

  const now = new Date()
  const end = new Date(trial.endDate)
  const diffMs = end.getTime() - now.getTime()
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  const isExpired = daysLeft <= 0
  const isUrgent = daysLeft <= 3 && daysLeft > 0

  let className = ''
  let text = ''
  if (isExpired) {
    className = 'bg-red-500 text-white border-red-500'
    text = '⏱ Trial expired — Upgrade'
  } else if (isUrgent) {
    className = 'bg-red-50 text-red-700 border-red-200'
    text = '⏱ ' + daysLeft + ' day' + (daysLeft > 1 ? 's' : '') + ' left'
  } else {
    className = 'bg-amber-50 text-amber-700 border-amber-200'
    text = '⏱ ' + daysLeft + ' days left'
  }

  return (
    <Link
      href="/dashboard/settings?tab=billing"
      className={"text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors whitespace-nowrap " + className}
    >
      {text}
    </Link>
  )
}
