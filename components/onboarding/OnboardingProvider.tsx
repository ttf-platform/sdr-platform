'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { WelcomeModal } from './WelcomeModal'
import { useOnboardingProgress, WELCOME_SESSION_KEY } from '@/lib/hooks/useOnboardingProgress'

/**
 * Mounts the welcome modal on the dashboard.
 *
 * Two dismiss semantics:
 * - Temporary — sessionStorage flag only. The modal reappears at the next
 *   login / new tab. No DB write.
 * - Permanent — PATCH welcome_dismissed_permanently=true. The modal never
 *   auto-shows again until the user explicitly clicks "Replay welcome tour"
 *   in the avatar dropdown (which resets both flags).
 *
 * Manual replay path: the avatar item calls context.replayWelcome() which
 * bumps welcomeReplayNonce; this component watches the nonce and re-opens
 * the modal.
 */
export function OnboardingProvider() {
  const { data, loading, welcomeReplayNonce, refetch } = useOnboardingProgress()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const autoShowEvaluated = useRef(false)
  const lastReplayNonceSeen = useRef(0)

  // Auto-show on first mount. Runs once when the context has finished its
  // initial fetch (data goes from null → populated). Gate:
  //   - welcome_dismissed_permanently !== true (persistent DB)
  //   - AND sessionStorage flag absent (current tab hasn't seen it yet)
  useEffect(() => {
    if (loading || autoShowEvaluated.current) return
    autoShowEvaluated.current = true

    const permanent = data?.stored?.welcome_dismissed_permanently === true
    let sessionSeen = false
    try {
      sessionSeen = typeof window !== 'undefined'
        && sessionStorage.getItem(WELCOME_SESSION_KEY) === '1'
    } catch { /* private-mode / disabled — treat as unseen, safer */ }

    if (!permanent && !sessionSeen) setOpen(true)
  }, [loading, data])

  // Manual replay from the avatar dropdown: nonce increments → open the
  // modal even if it was previously dismissed this session.
  useEffect(() => {
    if (welcomeReplayNonce > 0 && welcomeReplayNonce !== lastReplayNonceSeen.current) {
      lastReplayNonceSeen.current = welcomeReplayNonce
      setOpen(true)
    }
  }, [welcomeReplayNonce])

  function markSessionSeen() {
    try { sessionStorage.setItem(WELCOME_SESSION_KEY, '1') } catch { /* ignore */ }
  }

  async function handleDismissTemporary() {
    markSessionSeen()
    setOpen(false)
    // Deliberately NO PATCH — temporary dismiss must not persist to DB.
  }

  async function handleDismissPermanent() {
    markSessionSeen()
    setOpen(false)
    await fetch('/api/onboarding/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ welcome_dismissed_permanently: true }),
    })
  }

  function handleLetsGo() {
    // Step 1 of the checklist — the ICP anchor on Settings.
    router.push('/dashboard/profile#icp' as Route)
  }

  async function handleTrySample({ campaign_id }: { campaign_id: string }) {
    router.push(`/dashboard/campaigns/${campaign_id}?tab=approval_queue` as Route)
    // Refresh onboarding progress so the checklist reflects the sample seed
    // (last_campaign_id, campaign_created, etc.) without waiting for a nav
    // that already changed pathname.
    await refetch()
  }

  if (!open) return null
  return (
    <WelcomeModal
      onDismissTemporary={handleDismissTemporary}
      onDismissPermanent={handleDismissPermanent}
      onLetsGo={handleLetsGo}
      onTrySample={handleTrySample}
    />
  )
}
