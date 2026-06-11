'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { useOnboardingProgress } from '@/lib/hooks/useOnboardingProgress'
import type { OnboardingCompletions } from '@/lib/hooks/useOnboardingProgress'

type StepKey = Exclude<keyof OnboardingCompletions, 'last_campaign_id'>

interface ChecklistStep {
  key: StepKey
  title: string
  description: string
  href: (lastCampaignId: string | null) => string
}

const STEPS: ChecklistStep[] = [
  {
    key: 'icp_configured',
    title: 'Define your ICP',
    description: 'Tell Mirvo who you target',
    href: () => '/dashboard/settings#icp',
  },
  {
    key: 'domain_added',
    title: 'Add sending domain',
    description: 'Configure your domain for outbound',
    href: () => '/dashboard/settings/sending-domains/new',
  },
  {
    key: 'mailbox_connected',
    title: 'Connect your mailbox',
    description: 'Verify DNS — sending starts day 1',
    href: () => '/dashboard/settings/sending-domains/new',
  },
  {
    key: 'campaign_created',
    title: 'Create first campaign',
    description: 'Mirvo AI writes the emails',
    href: () => '/dashboard/campaigns',
  },
  {
    key: 'prospects_added',
    title: 'Add your prospects',
    description: 'CSV import or AI discovery',
    href: () => '/dashboard/campaigns',
  },
  {
    key: 'variants_reviewed',
    title: 'Review AI emails',
    description: 'Approval Queue — validate before send',
    href: () => '/dashboard/campaigns',
  },
  {
    key: 'campaign_launched',
    title: 'Launch campaign',
    description: 'Send today — no waiting period',
    href: () => '/dashboard/campaigns',
  },
]

function SparkCheckmark({ isRecent }: { isRecent: boolean }) {
  return (
    <div className="relative w-5 h-5 shrink-0">
      <motion.div
        initial={isRecent ? { scale: 0 } : false}
        animate={{ scale: 1 }}
        transition={isRecent ? { duration: 0.4, times: [0, 0.5, 1], type: 'spring', stiffness: 300 } : {}}
        className="w-5 h-5 rounded-full bg-[#3b6bef] flex items-center justify-center"
      >
        <svg viewBox="0 0 16 16" className="w-3 h-3">
          <motion.path
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 8.5 L7 12 L13 5"
            initial={isRecent ? { pathLength: 0 } : false}
            animate={{ pathLength: 1 }}
            transition={isRecent ? { duration: 0.35, delay: 0.15 } : {}}
          />
        </svg>
      </motion.div>
      {isRecent && (
        <motion.div
          initial={{ scale: 1, opacity: 0.7 }}
          animate={{ scale: 2.8, opacity: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="absolute inset-0 rounded-full bg-[#3b6bef] pointer-events-none"
        />
      )}
    </div>
  )
}

export function OnboardingChecklist() {
  const { data, loading, recentlyCompleted, dismissChecklist } = useOnboardingProgress()
  const [collapsed, setCollapsed] = useState(false)

  if (loading || !data) return null
  if (data.stored.checklist_dismissed) return null
  if (data.progress_percent === 100) return null

  const lastCampaignId = data.completions.last_campaign_id

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6, duration: 0.3, ease: 'easeOut' }}
      className="fixed bottom-6 left-6 z-40 w-[340px] max-w-[calc(100vw-3rem)]"
    >
      <div className="bg-white rounded-xl shadow-2xl border border-[#e5e0d6] overflow-hidden">

        {/* Header — click to toggle collapse */}
        <button
          onClick={() => setCollapsed(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[#fafaf7] transition-colors"
        >
          <div className="flex items-center gap-3">
            {/* Circular progress ring */}
            <div className="relative w-9 h-9 shrink-0">
              <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90">
                <circle cx="18" cy="18" r="15" fill="none" stroke="#e8e3dc" strokeWidth="3" />
                <motion.circle
                  cx="18" cy="18" r="15"
                  fill="none"
                  stroke="#3b6bef"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={`${(data.progress_percent / 100) * 94.2} 94.2`}
                  initial={false}
                  animate={{ strokeDasharray: `${(data.progress_percent / 100) * 94.2} 94.2` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-[#1a1a2e]">
                {data.progress_percent}%
              </div>
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-[#1a1a2e]">Setup Mirvo</div>
              <div className="text-xs text-[#8a7e6e]">{data.steps_completed}/{data.total_steps} steps done</div>
            </div>
          </div>
          <svg
            className={`w-4 h-4 text-[#8a7e6e] transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Collapsible step list */}
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}
            >
              <div className="border-t border-[#e5e0d6] max-h-[380px] overflow-y-auto">
                {STEPS.map((step, idx) => {
                  const isComplete = data.completions[step.key] === true
                  const isRecent   = recentlyCompleted === step.key

                  return (
                    <Link
                      key={step.key}
                      href={step.href(lastCampaignId) as Route}
                      className={`flex items-start gap-3 px-3 py-2.5 border-b border-[#f0ece4] last:border-b-0 hover:bg-[#fafaf7] transition-colors ${isComplete ? 'opacity-55' : ''}`}
                    >
                      {isComplete ? (
                        <SparkCheckmark isRecent={isRecent} />
                      ) : (
                        <div className="w-5 h-5 rounded-full border-2 border-[#d4cebf] shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium leading-snug ${isComplete ? 'text-[#8a7e6e] line-through' : 'text-[#1a1a2e]'}`}>
                          {idx + 1}. {step.title}
                        </div>
                        <div className="text-xs text-[#8a7e6e] mt-0.5">{step.description}</div>
                      </div>
                    </Link>
                  )
                })}
              </div>

              <div className="border-t border-[#e5e0d6] bg-[#fafaf7] px-3 py-2">
                <button
                  onClick={dismissChecklist}
                  className="w-full text-xs text-[#8a7e6e] hover:text-[#6b5e4e] py-1 transition-colors"
                >
                  Hide for now
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
