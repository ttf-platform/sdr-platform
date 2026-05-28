'use client'

import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { isAnalyticsAllowed } from '@/lib/cookie-consent'

let initialized = false

export function initPostHogIfAllowed() {
  if (initialized) return
  if (
    typeof window !== 'undefined' &&
    process.env.NODE_ENV === 'production' &&
    process.env.NEXT_PUBLIC_POSTHOG_KEY &&
    isAnalyticsAllowed()
  ) {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: 'https://eu.i.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: false,
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
    })
    initialized = true
  }
}

// Init au module load (cas où le consentement a déjà été donné précédemment)
initPostHogIfAllowed()

export function PHProvider({ children }: { children: React.ReactNode }) {
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
