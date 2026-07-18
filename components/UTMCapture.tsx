'use client'

import { useEffect } from 'react'
import posthog from 'posthog-js'
import { isAnalyticsAllowed } from '@/lib/cookie-consent'

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const
const STORAGE_KEY = 'sentra_utm'
const TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

// Hostnames considered internal — a referrer from these does not count as a
// separate acquisition channel and is discarded. Kept minimal (bare +
// www subdomain) because production is served on both, and staging /
// vercel previews do not need first-touch attribution.
const INTERNAL_HOSTS = new Set<string>(['mirvo.ai', 'www.mirvo.ai'])

type FirstTouchRecord = Partial<Record<typeof UTM_KEYS[number], string>> & {
  referrer?:   string
  captured_at: number
}

// Extract a bare hostname from document.referrer, or null if the value is
// empty, malformed, or points to an internal host. Query-string / path are
// intentionally discarded — bag of PII risk otherwise (see security review).
function externalReferrerHost(): string | null {
  const raw = document.referrer
  if (!raw) return null
  try {
    const host = new URL(raw).hostname.toLowerCase()
    if (!host) return null
    if (INTERNAL_HOSTS.has(host)) return null
    return host
  } catch {
    return null
  }
}

export function UTMCapture() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const utm: Partial<Record<typeof UTM_KEYS[number], string>> = {}
    for (const key of UTM_KEYS) {
      const val = params.get(key)
      if (val) utm[key] = val
    }

    // First-touch: only stamp storage if we don't already have a valid,
    // non-expired record. utms are the strongest anchor; if there are none
    // this run but we DO have an external referrer, that becomes the touch.
    let hasFreshRecord = false
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const stored: FirstTouchRecord = JSON.parse(raw)
        hasFreshRecord = Date.now() - stored.captured_at < TTL_MS
      }
    } catch {
      // corrupted / missing — treat as no record
    }

    // Consent-gate the write itself, not just downstream reads. Under
    // ePrivacy Article 5(3), first-party storage of tracking identifiers
    // (utm attribution + external referrer hostname) is not strictly
    // necessary for the service, so it requires prior consent. If the
    // user rejected analytics the record simply never lands — subsequent
    // signups from this browser send no acquisition payload, which is
    // the correct behaviour.
    if (!hasFreshRecord && isAnalyticsAllowed()) {
      const referrer = externalReferrerHost()
      const record: FirstTouchRecord = { ...utm, ...(referrer ? { referrer } : {}), captured_at: Date.now() }
      // Only persist if the record carries at least one signal beyond the
      // timestamp — otherwise the row is noise.
      const hasSignal = Object.keys(record).some(k => k !== 'captured_at')
      if (hasSignal) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
        } catch {
          // localStorage may fail in private mode, ignore
        }
      }
    }

    // PostHog wiring stays UTM-only. PostHog already captures $referrer at
    // pageview time; re-registering it as a super property here would
    // duplicate the signal without adding value.
    if (Object.keys(utm).length > 0 && isAnalyticsAllowed()) {
      try {
        posthog.register(utm)
      } catch (err) {
        console.warn('[posthog] UTM register failed:', err)
      }
    } else if (Object.keys(utm).length === 0 && isAnalyticsAllowed()) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const stored: FirstTouchRecord = JSON.parse(raw)
          if (Date.now() - stored.captured_at < TTL_MS) {
            const { captured_at: _c, referrer: _r, ...savedUtm } = stored
            if (Object.keys(savedUtm).length > 0) {
              posthog.register(savedUtm)
            }
          } else {
            localStorage.removeItem(STORAGE_KEY)
          }
        }
      } catch {
        // JSON parse may fail if storage corrupted, ignore
      }
    }
  }, [])

  return null
}
