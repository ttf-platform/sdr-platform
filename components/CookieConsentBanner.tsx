'use client'

import { useEffect, useState } from 'react'
import { setConsent, hasConsentBeenGiven } from '@/lib/cookie-consent'

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!hasConsentBeenGiven()) setVisible(true)
  }, [])

  function handleAccept() {
    setConsent('accepted')
    setVisible(false)
    window.location.reload()
  }

  function handleReject() {
    setConsent('rejected')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-banner-title"
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-50 bg-white border border-[#e8e3dc] rounded-2xl shadow-2xl p-5"
    >
      <h2 id="cookie-banner-title" className="text-sm font-semibold text-[#1a1a2e] mb-2">
        We respect your privacy
      </h2>
      <p className="text-xs text-[#6b5e4e] mb-4 leading-relaxed">
        We use essential cookies to make Mirvo work, and analytics cookies to understand how you use the product so we can improve it. You can reject analytics anytime.{' '}
        <a href="/en/legal/cookies" className="text-[#3b6bef] hover:underline">Learn more</a>
      </p>
      <div className="flex gap-2 justify-end">
        <button
          onClick={handleReject}
          className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-3 py-2.5 text-xs font-medium hover:bg-[#f7f4f0] transition-colors"
        >
          Reject analytics
        </button>
        <button
          onClick={handleAccept}
          className="bg-[#3b6bef] text-white rounded-lg px-3 py-2.5 text-xs font-medium hover:bg-[#2d5cdc] transition-colors"
        >
          Accept all
        </button>
      </div>
    </div>
  )
}
