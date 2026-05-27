'use client'

import { useEffect, useState } from 'react'
import { WelcomeModal } from './WelcomeModal'

export function OnboardingProvider() {
  const [shouldShowWelcome, setShouldShowWelcome] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/onboarding/progress')
      .then((r) => r.json())
      .then((data) => {
        const dismissed = data?.stored?.welcome_dismissed === true
        setShouldShowWelcome(!dismissed)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  async function handleDismiss() {
    await fetch('/api/onboarding/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ welcome_dismissed: true }),
    })
    setShouldShowWelcome(false)
  }

  if (!loaded || !shouldShowWelcome) return null
  return <WelcomeModal onDismiss={handleDismiss} />
}
