'use client'

export type ConsentValue = 'accepted' | 'rejected' | null

const COOKIE_NAME = 'sentra_cookie_consent'
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60

export function getConsent(): ConsentValue {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(^| )${COOKIE_NAME}=([^;]+)`))
  if (!match) return null
  const value = match[2]
  return value === 'accepted' || value === 'rejected' ? value : null
}

export function setConsent(value: 'accepted' | 'rejected'): void {
  if (typeof document === 'undefined') return
  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:'
  document.cookie = `${COOKIE_NAME}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${isSecure ? '; Secure' : ''}`
}

export function hasConsentBeenGiven(): boolean {
  return getConsent() !== null
}

export function isAnalyticsAllowed(): boolean {
  return getConsent() === 'accepted'
}
