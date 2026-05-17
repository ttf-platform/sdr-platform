'use client'

import { useEffect } from 'react'
import posthog from 'posthog-js'

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const
const STORAGE_KEY = 'sentra_utm'
const TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

type UtmRecord = Partial<Record<typeof UTM_KEYS[number], string>> & { captured_at: number }

export function UTMCapture() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const utm: Partial<Record<typeof UTM_KEYS[number], string>> = {}
    for (const key of UTM_KEYS) {
      const val = params.get(key)
      if (val) utm[key] = val
    }

    if (Object.keys(utm).length > 0) {
      const record: UtmRecord = { ...utm, captured_at: Date.now() }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
      } catch {
        // localStorage may fail in private mode, ignore
      }
      try {
        posthog.register(utm)
      } catch (err) {
        console.warn('[posthog] UTM register failed:', err)
      }
    } else {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const stored: UtmRecord = JSON.parse(raw)
          if (Date.now() - stored.captured_at < TTL_MS) {
            const { captured_at, ...savedUtm } = stored
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
