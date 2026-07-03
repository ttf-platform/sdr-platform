'use client'

import { Sparkles } from 'lucide-react'
import { useOnboardingProgress } from '@/lib/hooks/useOnboardingProgress'

/**
 * Menu item that re-opens the welcome modal even after a permanent dismiss.
 *
 * Kept as its own component so it can call useOnboardingProgress() from
 * inside the OnboardingProgressProvider subtree — the parent DashboardLayout
 * function body itself sits above the provider and cannot use the hook.
 *
 * onClick is invoked before replayWelcome() so the caller (the avatar
 * dropdown) can close itself synchronously; the async replay then bumps the
 * provider's welcomeReplayNonce, which OnboardingProvider watches to open
 * the modal.
 */
export function ReplayWelcomeMenuItem({ onClick }: { onClick?: () => void }) {
  const { replayWelcome } = useOnboardingProgress()

  async function handleClick() {
    onClick?.()
    await replayWelcome()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[#1a1a1a] hover:bg-[#f7f4f0] focus-visible:outline-none focus-visible:bg-[#f7f4f0]"
    >
      <Sparkles size={14} /> Replay welcome tour
    </button>
  )
}
