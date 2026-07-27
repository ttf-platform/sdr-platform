'use client'
import { use, useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { safeExternalHref } from '@/lib/url-safety'

// Public confirmation landing page.
// Client component that POSTs the token to /api/book/confirm/[token] on
// mount, then renders one of five terminal states :
//   confirmed / already_confirmed → date/time + ICS + calendar links
//   expired                       → "pick a fresh slot" (CTA back to booking)
//   slot_taken                    → "pick another slot" (CTA back to booking)
//   unknown                       → "link not valid"
//   db_error                      → "try again in a moment"
//
// The token is in the URL PATH (not query params) on purpose : PostHog is
// initialised with capture_pageview: true (app/providers.tsx) which would
// send the full URL — including query params — to analytics. Path-level
// tokens are still captured but PostHog's default masking neutralises
// `[token]` segments; more importantly, sharing a screenshot / DevTools
// URL bar with a token in the query would be a leak vector, and the path
// form keeps the failure mode consistent.

type ConfirmedMeeting = {
  meeting: { id: string; meeting_at: string; duration_min: number; booking_slug: string | null }
  ics: string
  calendar_links: { google: string; outlook365: string; outlookLive: string; yahoo: string }
}

type ConfirmResponse =
  | ({ outcome: 'confirmed' } & ConfirmedMeeting)
  | ({ outcome: 'already_confirmed' } & ConfirmedMeeting)
  | { outcome: 'expired' }
  | { outcome: 'slot_taken' }
  | { outcome: 'unknown' }
  | { outcome: 'db_error'; message?: string }

export default function BookConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const t = useTranslations('book')
  const locale = useLocale()

  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'done'; response: ConfirmResponse }
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetch(`/api/book/confirm/${token}`, { method: 'POST' })
      .then(async r => {
        const body = await r.json().catch(() => ({ outcome: 'db_error' as const }))
        return body as ConfirmResponse
      })
      .then(response => {
        if (cancelled) return
        setState({ status: 'done', response })
      })
      .catch(() => {
        if (cancelled) return
        setState({ status: 'done', response: { outcome: 'db_error' } })
      })
    return () => { cancelled = true }
  }, [token])

  // Meeting-page slug for "pick another slot" CTAs. Only populated on
  // confirmed / already_confirmed outcomes ; on slot_taken/expired we
  // display a generic notice with no back-link (we don't know the slug).
  const bookingSlug =
    state.status === 'done' &&
    (state.response.outcome === 'confirmed' || state.response.outcome === 'already_confirmed')
      ? state.response.meeting.booking_slug
      : null

  function fmtDateTime(iso: string): { date: string; time: string } {
    const d = new Date(iso)
    const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'
    return {
      date: new Intl.DateTimeFormat(locale, {
        timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }).format(d),
      time: new Intl.DateTimeFormat(locale, {
        timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: locale.startsWith('en'),
      }).format(d),
    }
  }

  function downloadICS(ics: string) {
    const blob = new Blob([ics], { type: 'text/calendar' })
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: 'meeting.ics',
    })
    a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <div className="min-h-screen bg-[#f5f2ee] py-12 px-4">
      <div className="max-w-md mx-auto">
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-6">
          {state.status === 'loading' && (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-[#3b6bef] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-[#8a7e6e]">{t('confirmingTitle')}</p>
            </div>
          )}

          {state.status === 'done' && (state.response.outcome === 'confirmed' || state.response.outcome === 'already_confirmed') && (() => {
            const meeting = state.response.meeting
            const links = state.response.calendar_links
            const ics = state.response.ics
            const { date: confDate, time: confTime } = fmtDateTime(meeting.meeting_at)
            const isAlreadyConfirmed = state.response.outcome === 'already_confirmed'
            return (
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-[#1a1a2e] mb-1">
                  {isAlreadyConfirmed ? t('alreadyConfirmedTitle') : t('confirmedHeading')}
                </h2>
                <p className="text-sm text-[#8a7e6e] mb-5">
                  {isAlreadyConfirmed ? t('alreadyConfirmedBody') : t('confirmedSubHeading')}
                </p>

                <div className="bg-[#f5f2ee] rounded-lg p-4 text-left mb-6 text-sm">
                  <p className="font-semibold text-[#1a1a2e]">{confDate}</p>
                  <p className="text-[#8a7e6e] mt-0.5">
                    {confTime} · {meeting.duration_min} min
                  </p>
                </div>

                <p className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wide mb-1">{t('addToCalendar')}</p>
                <p className="text-xs text-[#8a7e6e] mb-3">{t('icsNote')}</p>
                <div className="flex flex-col gap-2">
                  <a href={links.google} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-[#e8e3dc] text-sm font-medium text-[#1a1a2e] hover:border-[#3b6bef] hover:bg-[#3b6bef]/5 transition-colors">
                    <span className="text-base">📅</span> {t('googleCalendar')}
                  </a>
                  <a href={links.outlook365} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-[#e8e3dc] text-sm font-medium text-[#1a1a2e] hover:border-[#3b6bef] hover:bg-[#3b6bef]/5 transition-colors">
                    <span className="text-base">📅</span> {t('outlookO365')}
                  </a>
                  <a href={links.outlookLive} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-[#e8e3dc] text-sm font-medium text-[#1a1a2e] hover:border-[#3b6bef] hover:bg-[#3b6bef]/5 transition-colors">
                    <span className="text-base">📅</span> {t('outlookCom')}
                  </a>
                  <a href={links.yahoo} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-[#e8e3dc] text-sm font-medium text-[#1a1a2e] hover:border-[#3b6bef] hover:bg-[#3b6bef]/5 transition-colors">
                    <span className="text-base">📅</span> {t('yahooCalendar')}
                  </a>
                  <button onClick={() => downloadICS(ics)}
                    className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-[#e8e3dc] text-sm font-medium text-[#1a1a2e] hover:border-[#3b6bef] hover:bg-[#3b6bef]/5 transition-colors">
                    <span className="text-base">📥</span> {t('downloadICS')}
                  </button>
                </div>

                {!isAlreadyConfirmed && <p className="text-sm text-[#8a7e6e] mt-5">{t('allSet')}</p>}
              </div>
            )
          })()}

          {state.status === 'done' && state.response.outcome === 'expired' && (
            <div className="text-center">
              <div className="text-4xl mb-3">⏳</div>
              <h2 className="text-xl font-bold text-[#1a1a2e] mb-2">{t('expiredTitle')}</h2>
              <p className="text-sm text-[#4a3f32] mb-5 leading-relaxed">{t('expiredBody')}</p>
            </div>
          )}

          {state.status === 'done' && state.response.outcome === 'slot_taken' && (
            <div className="text-center">
              <div className="text-4xl mb-3">📆</div>
              <h2 className="text-xl font-bold text-[#1a1a2e] mb-2">{t('slotTakenTitle')}</h2>
              <p className="text-sm text-[#4a3f32] leading-relaxed">{t('slotTakenBody')}</p>
              {bookingSlug && (() => {
                const href = safeExternalHref(`/book/${bookingSlug}`)
                return href ? (
                  <a href={href}
                    className="inline-block mt-5 bg-[#3b6bef] text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-[#2f57c9] transition-colors">
                    {t('slotTakenCta')}
                  </a>
                ) : null
              })()}
            </div>
          )}

          {state.status === 'done' && state.response.outcome === 'unknown' && (
            <div className="text-center">
              <div className="text-4xl mb-3">🔍</div>
              <h2 className="text-xl font-bold text-[#1a1a2e] mb-2">{t('unknownTitle')}</h2>
              <p className="text-sm text-[#4a3f32] leading-relaxed">{t('unknownBody')}</p>
            </div>
          )}

          {state.status === 'done' && state.response.outcome === 'db_error' && (
            <div className="text-center">
              <div className="text-4xl mb-3">⚠️</div>
              <h2 className="text-xl font-bold text-[#1a1a2e] mb-2">{t('confirmErrorTitle')}</h2>
              <p className="text-sm text-[#4a3f32] leading-relaxed">{t('confirmErrorBody')}</p>
            </div>
          )}
        </div>

        <p className="text-center mt-6 text-xs text-[#8a7e6e]">{t('poweredBy')} <span className="font-semibold">Mirvo</span></p>
      </div>
    </div>
  )
}
