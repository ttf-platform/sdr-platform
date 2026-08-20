'use client'
import { use, useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { safeExternalHref } from '@/lib/url-safety'

// Public confirmation landing page.
//
// Design goals for this page (post-audit-site-#4 PR2 corrections) :
//
//   1. NEVER auto-confirm on page mount. JS-executing security scanners
//      (link-preview fetchers, spam-gateway sandboxes, corporate URL
//      rewriters that actually run the JS) would otherwise confirm on the
//      visitor's behalf. This page :
//          - fetches the state read-only on mount (GET, no side-effects),
//          - shows a "Confirm my meeting" button when status is pending,
//          - only fires the confirmation POST on the button's onClick.
//
//   2. Strip the token from the URL as soon as the page has read it. The
//      previous revision claimed PostHog "masks [token] segments" — that
//      was WRONG. PostHog's capture_pageview: true (app/providers.tsx)
//      captures the real URL path. history.replaceState rewrites it to
//      /book/confirm/redacted so no analytics / referer / clipboard-share
//      captures the token itself. The value is kept in a ref that survives
//      the URL swap for the POST call.
//
// Six outcomes rendered (loading → done):
//     pending           → shows details + "Confirm my meeting" button
//     confirmed         → date/time + ICS + calendar links (post-click)
//     already_confirmed → same + "already confirmed" title (re-click)
//     expired           → "pick a fresh slot"
//     slot_passed       → "this time has passed"  (M2 : slot < now())
//     slot_taken        → "someone confirmed before you"
//     unknown           → "link not valid"
//     db_error          → "try again"
//     availability_unavailable → "we could not verify — retryable" (LC21 (3)C)

type ConfirmedPayload = {
  meeting: { id: string; meeting_at: string; duration_min: number; booking_slug: string | null }
  ics: string
  calendar_links: { google: string; outlook365: string; outlookLive: string; yahoo: string }
}

type PendingPayload = {
  meeting: { id: string; meeting_at: string; duration_min: number; booking_slug: string | null }
}

type PeekResponse =
  | ({ outcome: 'pending' } & PendingPayload)
  | ({ outcome: 'confirmed' } & ConfirmedPayload)
  | ({ outcome: 'already_confirmed' } & ConfirmedPayload)
  | { outcome: 'expired' }
  | { outcome: 'slot_passed' }
  | { outcome: 'slot_taken' }
  | { outcome: 'unknown' }
  | { outcome: 'db_error'; message?: string }
  // LC21 (3)C — la disponibilite n'a pas pu etre ETABLIE : miroir illisible,
  // perime, ou creneau hors de la fenetre reellement synchronisee. Etat
  // REESSAYABLE, et distinct de slot_taken : dire « quelqu'un a confirme avant
  // vous » quand la verite est « nous n'avons pas pu verifier » serait un
  // mensonge au prospect.
  | { outcome: 'availability_unavailable' }

export default function BookConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const t = useTranslations('book')
  const locale = useLocale()

  const [peek, setPeek] = useState<
    | { status: 'loading' }
    | { status: 'done'; response: PeekResponse }
  >({ status: 'loading' })
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let cancelled = false

    // Strip the token from the URL before the first render commits it to
    // history. Path segments are captured by PostHog (capture_pageview:
    // true) — we rewrite to a redacted marker so the token doesn't land
    // in analytics, referers, or clipboard shares.
    if (typeof window !== 'undefined') {
      try { window.history.replaceState(null, '', '/book/confirm/redacted') } catch { /* ignore */ }
    }

    // ?locale=<locale> on BOTH GET + POST : the route uses this to pick
    // the language of the .ics SUMMARY and the "Add to Google Calendar /
    // Outlook" link title / description, so both the calendar-link
    // buttons and the .ics file the visitor downloads from this screen
    // read in the same language they're reading right now.
    // Link-preview fetchers / spam sandboxes DON'T send this param — the
    // route falls back to 'en', see parseLocaleQP in the route.
    fetch(`/api/book/confirm/${token}?locale=${locale}`, { method: 'GET' })
      .then(async r => {
        const body = await r.json().catch(() => ({ outcome: 'db_error' as const }))
        return body as PeekResponse
      })
      .then(response => {
        if (cancelled) return
        setPeek({ status: 'done', response })
      })
      .catch(() => {
        if (cancelled) return
        setPeek({ status: 'done', response: { outcome: 'db_error' } })
      })
    return () => { cancelled = true }
  }, [token, locale])

  async function onConfirmClick() {
    setConfirming(true)
    const res = await fetch(`/api/book/confirm/${token}?locale=${locale}`, { method: 'POST' })
      .then(async r => {
        const body = await r.json().catch(() => ({ outcome: 'db_error' as const }))
        return body as PeekResponse
      })
      .catch(() => ({ outcome: 'db_error' as const }))
    setPeek({ status: 'done', response: res })
    setConfirming(false)
  }

  const bookingSlug =
    peek.status === 'done' &&
    (peek.response.outcome === 'pending' ||
     peek.response.outcome === 'confirmed' ||
     peek.response.outcome === 'already_confirmed')
      ? peek.response.meeting.booking_slug
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
          {peek.status === 'loading' && (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-[#3b6bef] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-[#8a7e6e]">{t('confirmingTitle')}</p>
            </div>
          )}

          {/* PENDING — the "Confirm my meeting" button is the ONLY code
              path that triggers the confirmation POST. */}
          {peek.status === 'done' && peek.response.outcome === 'pending' && (() => {
            const meeting = peek.response.meeting
            const { date: mDate, time: mTime } = fmtDateTime(meeting.meeting_at)
            return (
              <div className="text-center">
                <h2 className="text-xl font-bold text-[#1a1a2e] mb-1">{t('confirmDetailsTitle')}</h2>
                <p className="text-sm text-[#8a7e6e] mb-5">{t('confirmDetailsSub')}</p>

                <div className="bg-[#f5f2ee] rounded-lg p-4 text-left mb-5 text-sm">
                  <p className="font-semibold text-[#1a1a2e]">{mDate}</p>
                  <p className="text-[#8a7e6e] mt-0.5">{mTime} · {meeting.duration_min} min</p>
                </div>

                <button
                  type="button"
                  onClick={onConfirmClick}
                  disabled={confirming}
                  className="w-full bg-[#3b6bef] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#2f57c9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {confirming ? t('confirmBusy') : t('confirmCta')}
                </button>
              </div>
            )
          })()}

          {/* CONFIRMED / ALREADY_CONFIRMED */}
          {peek.status === 'done' && (peek.response.outcome === 'confirmed' || peek.response.outcome === 'already_confirmed') && (() => {
            const meeting = peek.response.meeting
            const links   = peek.response.calendar_links
            const ics     = peek.response.ics
            const { date: confDate, time: confTime } = fmtDateTime(meeting.meeting_at)
            const isAlreadyConfirmed = peek.response.outcome === 'already_confirmed'
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

          {peek.status === 'done' && peek.response.outcome === 'expired' && (
            <div className="text-center">
              <div className="text-4xl mb-3">⏳</div>
              <h2 className="text-xl font-bold text-[#1a1a2e] mb-2">{t('expiredTitle')}</h2>
              <p className="text-sm text-[#4a3f32] leading-relaxed">{t('expiredBody')}</p>
            </div>
          )}

          {peek.status === 'done' && peek.response.outcome === 'slot_passed' && (
            <div className="text-center">
              <div className="text-4xl mb-3">⏰</div>
              <h2 className="text-xl font-bold text-[#1a1a2e] mb-2">{t('slotPassedTitle')}</h2>
              <p className="text-sm text-[#4a3f32] leading-relaxed">{t('slotPassedBody')}</p>
              {bookingSlug && (() => {
                const href = safeExternalHref(`/book/${bookingSlug}`)
                return href ? (
                  <a href={href}
                    className="inline-block mt-5 bg-[#3b6bef] text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-[#2f57c9] transition-colors">
                    {t('slotPassedCta')}
                  </a>
                ) : null
              })()}
            </div>
          )}

          {peek.status === 'done' && peek.response.outcome === 'slot_taken' && (
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

          {peek.status === 'done' && peek.response.outcome === 'unknown' && (
            <div className="text-center">
              <div className="text-4xl mb-3">🔍</div>
              <h2 className="text-xl font-bold text-[#1a1a2e] mb-2">{t('unknownTitle')}</h2>
              <p className="text-sm text-[#4a3f32] leading-relaxed">{t('unknownBody')}</p>
            </div>
          )}

          {peek.status === 'done' && peek.response.outcome === 'availability_unavailable' && (
            <div className="text-center">
              <div className="text-4xl mb-3">🕒</div>
              <h2 className="text-xl font-bold text-[#1a1a2e] mb-2">{t('availabilityUnavailableTitle')}</h2>
              <p className="text-sm text-[#4a3f32] leading-relaxed">{t('availabilityUnavailableBody')}</p>
            </div>
          )}

          {peek.status === 'done' && peek.response.outcome === 'db_error' && (
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
