'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import type { ReactNode } from 'react'

export interface OnboardingCompletions {
  icp_configured: boolean
  domain_added: boolean
  mailbox_connected: boolean
  campaign_created: boolean
  prospects_added: boolean
  variants_reviewed: boolean
  campaign_launched: boolean
  last_campaign_id: string | null
}

export interface OnboardingProgressData {
  workspace_id: string
  stored: {
    welcome_dismissed?: boolean
    checklist_dismissed?: boolean
    try_mirvo_mode?: boolean
    last_campaign_id?: string | null
  }
  completions: OnboardingCompletions
  progress_percent: number
  steps_completed: number
  total_steps: number
}

type StepKey = Exclude<keyof OnboardingCompletions, 'last_campaign_id'>

const STEP_LABELS: Record<StepKey, string> = {
  icp_configured:    'ICP defined',
  domain_added:      'Sending domain added',
  mailbox_connected: 'Mailbox connected',
  campaign_created:  'First campaign created',
  prospects_added:   'First prospect added',
  variants_reviewed: 'First email variant approved',
  campaign_launched: 'First campaign launched',
}

const STEP_KEYS: StepKey[] = [
  'icp_configured',
  'domain_added',
  'mailbox_connected',
  'campaign_created',
  'prospects_added',
  'variants_reviewed',
  'campaign_launched',
]

interface OnboardingContextValue {
  data: OnboardingProgressData | null
  loading: boolean
  recentlyCompleted: StepKey | null
  refetch: () => Promise<void>
  dismissChecklist: () => Promise<void>
  resumeChecklist: () => Promise<void>
}

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined)

export function OnboardingProgressProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<OnboardingProgressData | null>(null)
  const [loading, setLoading] = useState(true)
  const [recentlyCompleted, setRecentlyCompleted] = useState<StepKey | null>(null)
  const previousCompletions = useRef<OnboardingCompletions | null>(null)
  const pathname = usePathname()

  async function fetchProgress() {
    try {
      const res = await fetch('/api/onboarding/progress')
      if (!res.ok) return
      const json: OnboardingProgressData = await res.json()

      if (previousCompletions.current) {
        for (const key of STEP_KEYS) {
          const wasIncomplete = !previousCompletions.current[key]
          const isNowComplete = json.completions[key] === true
          if (wasIncomplete && isNowComplete) {
            setRecentlyCompleted(key)
            toast.success(`${STEP_LABELS[key]} ✓`, {
              description: 'Onboarding progress updated',
              duration: 3500,
            })
            setTimeout(() => setRecentlyCompleted(null), 2000)
          }
        }
      }

      previousCompletions.current = json.completions
      setData(json)
    } catch {
      // silent — non-critical
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProgress()
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  async function dismissChecklist() {
    await fetch('/api/onboarding/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checklist_dismissed: true }),
    })
    setData(prev =>
      prev ? { ...prev, stored: { ...prev.stored, checklist_dismissed: true } } : prev
    )
  }

  async function resumeChecklist() {
    await fetch('/api/onboarding/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checklist_dismissed: false }),
    })
    setData(prev =>
      prev ? { ...prev, stored: { ...prev.stored, checklist_dismissed: false } } : prev
    )
  }

  return (
    <OnboardingContext.Provider value={{ data, loading, recentlyCompleted, refetch: fetchProgress, dismissChecklist, resumeChecklist }}>
      {children}
    </OnboardingContext.Provider>
  )
}

export function useOnboardingProgress() {
  const ctx = useContext(OnboardingContext)
  if (!ctx) throw new Error('useOnboardingProgress must be used within OnboardingProgressProvider')
  return ctx
}
