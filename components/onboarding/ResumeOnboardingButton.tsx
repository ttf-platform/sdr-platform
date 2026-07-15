'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { useOnboardingProgress } from '@/lib/hooks/useOnboardingProgress'

export function ResumeOnboardingButton() {
  const t = useTranslations('components.onboarding.resume')
  const { data, loading, resumeChecklist } = useOnboardingProgress()

  if (loading || !data) return null
  if (!data.stored.checklist_dismissed) return null
  if (data.progress_percent === 100) return null

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.3 }}
      onClick={resumeChecklist}
      className="fixed bottom-6 left-6 z-40 flex items-center gap-2 bg-white border border-[#e5e0d6] rounded-full shadow-lg hover:shadow-xl hover:border-[#3b6bef] px-4 py-2.5 transition-all group"
      aria-label={t('ariaLabel')}
    >
      <div className="relative w-7 h-7 shrink-0">
        <svg viewBox="0 0 36 36" className="w-7 h-7 -rotate-90">
          <circle cx="18" cy="18" r="15" fill="none" stroke="#e5e0d6" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15"
            fill="none"
            stroke="#3b6bef"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(data.progress_percent / 100) * 94} 94`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-[#1a1a2e]">
          {data.progress_percent}%
        </div>
      </div>
      <span className="text-sm font-medium text-[#1a1a2e] group-hover:text-[#3b6bef] transition-colors">
        {t('cta')}
      </span>
    </motion.button>
  )
}
