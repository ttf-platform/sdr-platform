'use client'

export type ConsentValue = 'accepted' | 'rejected' | null

// Current cookie name (Mirvo). Written by setConsent + preferred by getConsent.
const COOKIE_NAME = 'mirvo_cookie_consent'
// Legacy cookie name (Sentra rebrand). Read as fallback so existing users are
// NOT re-prompted; migrated transparently to the new name on first read.
// Safe to remove this fallback after ~2027-01-09 (≈6 months of rebrand runway).
const LEGACY_COOKIE_NAME = 'sentra_cookie_consent'

const COOKIE_MAX_AGE = 365 * 24 * 60 * 60

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`))
  return match ? match[2] : null
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:'
  document.cookie = `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${isSecure ? '; Secure' : ''}`
}

function normalizeValue(raw: string | null): ConsentValue {
  return raw === 'accepted' || raw === 'rejected' ? raw : null
}

export function getConsent(): ConsentValue {
  if (typeof document === 'undefined') return null

  // 1) Preferred name — mirvo_cookie_consent.
  const current = normalizeValue(readCookie(COOKIE_NAME))
  if (current !== null) return current

  // 2) Legacy fallback — sentra_cookie_consent. On hit, migrate transparently
  //    (rewrite under the new name + expire the legacy name) so we only run
  //    this branch once per user, not on every read.
  const legacy = normalizeValue(readCookie(LEGACY_COOKIE_NAME))
  if (legacy !== null) {
    writeCookie(COOKIE_NAME, legacy, COOKIE_MAX_AGE)
    writeCookie(LEGACY_COOKIE_NAME, '', 0)   // expire the legacy cookie
  }
  return legacy
}

export function setConsent(value: 'accepted' | 'rejected'): void {
  if (typeof document === 'undefined') return
  writeCookie(COOKIE_NAME, value, COOKIE_MAX_AGE)
  // If the user goes through the banner while a legacy cookie still exists
  // (edge case: first visit after code deploy, they clicked before we got a
  // chance to migrate in getConsent), evict it so no ghost cookie survives.
  if (readCookie(LEGACY_COOKIE_NAME) !== null) {
    writeCookie(LEGACY_COOKIE_NAME, '', 0)
  }
}

export function hasConsentBeenGiven(): boolean {
  return getConsent() !== null
}

export function isAnalyticsAllowed(): boolean {
  return getConsent() === 'accepted'
}
