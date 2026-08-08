'use client'

/**
 * ConnectMailboxButton — OAuth mailbox connection (Sprint A1).
 *
 * Flow:
 *   1. User clicks the CTA → inline provider picker (Google / Microsoft).
 *   2. Provider choice → window.open('about:blank', ...) IMMEDIATELY, still
 *      inside the click gesture, BEFORE any await. Safari (measured) refuses
 *      a window.open placed after an await intercalated with an async fetch,
 *      even when the resulting URL is same-origin : the browser's permission
 *      to open a window is lost as soon as any asynchronous wait is
 *      interposed between the click and window.open. Measured with a fetch
 *      of ~470 ms ; the exact granularity was not measured. Opening
 *      about:blank first keeps the popup handle alive without exposing any URL.
 *   3. POST /api/email-accounts/oauth/init { provider } ; then validate the
 *      returned authUrl through isAuthUrlSafe ; THEN navigate the popup via
 *      popup.location.replace(authUrl).
 *      Invariant : the popup never leaves about:blank until the URL has
 *      been validated.
 *   4. If window.open returned null (browser refused the popup, e.g. Safari
 *      strict blocker, or an extension), no automatic navigation is
 *      attempted. A visible fallback surfaces below the CTA with a native
 *      <a target="_blank"> link — a link click bypasses the programmatic-
 *      popup rule the way an about:blank opener does not. Polling starts
 *      on that click, not before.
 *   5. Poll GET /api/email-accounts/oauth/status/{sessionId} every 5s
 *      → success: toast + router.refresh()
 *      → 410 expired / timeout 10min: toast.error
 *      → 402 plan cap: toast.error
 *      → other non-2xx: generic toast.error
 *
 * Design tokens: #3b6bef CTA, #1a1a1a head, #4a4a5a body, #e8e3dc border,
 * focus-visible rings. Secondary visual: outline button (vs the primary
 * "Add sending domain" link).
 *
 * Copy convention: this file is intentionally English-only ; no next-intl
 * strings live here, and the fallback UI added in this file keeps that.
 *
 * A11y: click-outside + Escape close the dropdown; focus moves to first
 * menu item on open and back to the trigger on close; trigger gets
 * aria-busy while connecting; toasts inherit aria-live from sonner.
 */

import { forwardRef, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

type Provider = 'google' | 'microsoft'

const POLL_INTERVAL_MS = 5_000
const SESSION_TTL_MS   = 10 * 60 * 1000

// Allowlist of authUrl hosts per provider. Defense against a compromised /
// misconfigured provider response steering the popup to a phishing page
// (e.g. javascript:, data:, http:, attacker-controlled https origins, or
// path-traversal tricks like `/mock-callback../foo`).
//
// Parsing via URL() rather than startsWith() guarantees the host is the
// exact provider host (not a suffix match like accounts.google.com.evil.com),
// the scheme is https, and the same-origin mock fallback resolves to the
// exact documented path.
const PROVIDER_HOST: Record<Provider, string> = {
  google:    'accounts.google.com',
  microsoft: 'login.microsoftonline.com',
}
const MOCK_CALLBACK_PATH = '/api/email-accounts/oauth/mock-callback'

function isAuthUrlSafe(provider: Provider, raw: string): boolean {
  if (typeof raw !== 'string' || raw.length === 0) return false
  let u: URL
  try {
    u = new URL(raw, window.location.origin)
  } catch {
    return false
  }

  // Same-origin mock fallback — only the documented path, nothing else.
  if (u.origin === window.location.origin) {
    return u.pathname === MOCK_CALLBACK_PATH
  }

  // Off-origin: HTTPS + exact provider hostname.
  if (u.protocol !== 'https:') return false
  return u.hostname === PROVIDER_HOST[provider]
}

type Fallback = { provider: Provider; authUrl: string; sessionId: string }

export function ConnectMailboxButton() {
  const router = useRouter()
  const [open,     setOpen]     = useState(false)
  const [busy,     setBusy]     = useState<Provider | null>(null)
  // Fallback card — non-null only when window.open returned null AND the
  // authUrl coming back from init cleared isAuthUrlSafe. See startProvider.
  const [fallback, setFallback] = useState<Fallback | null>(null)

  // Refs for popup + polling lifecycle
  const popupRef    = useRef<Window | null>(null)
  const pollTimer   = useRef<ReturnType<typeof setInterval> | null>(null)
  const deadline    = useRef<number>(0)
  const sessionRef  = useRef<string | null>(null)

  // Refs for keyboard / focus management of the dropdown menu
  const triggerRef   = useRef<HTMLButtonElement>(null)
  const menuRef      = useRef<HTMLDivElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
      if (popupRef.current && !popupRef.current.closed) {
        try { popupRef.current.close() } catch { /* ignore */ }
      }
    }
  }, [])

  // Close menu on outside click + Escape; move focus when opening.
  useEffect(() => {
    if (!open) return

    function onDocPointer(e: MouseEvent) {
      const t = e.target as Node | null
      if (!t) return
      if (menuRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', onDocPointer)
    document.addEventListener('keydown', onKey)
    // Defer to next frame so the menu node is mounted before we focus.
    const id = requestAnimationFrame(() => firstItemRef.current?.focus())

    return () => {
      document.removeEventListener('mousedown', onDocPointer)
      document.removeEventListener('keydown', onKey)
      cancelAnimationFrame(id)
    }
  }, [open])

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
    if (popupRef.current && !popupRef.current.closed) {
      try { popupRef.current.close() } catch { /* ignore */ }
    }
    sessionRef.current = null
    setBusy(null)
    setFallback(null)
  }

  async function pollOnce() {
    const sessionId = sessionRef.current
    if (!sessionId) return

    if (Date.now() > deadline.current) {
      stopPolling()
      toast.error('Connection timed out. Please try again.')
      return
    }

    try {
      const res = await fetch(
        `/api/email-accounts/oauth/status/${encodeURIComponent(sessionId)}`,
        { cache: 'no-store' },
      )
      const body = await res.json().catch(() => ({}))

      if (res.status === 200 && body?.status === 'pending') return  // keep polling

      if (res.status === 200 && body?.status === 'success') {
        stopPolling()
        toast.success('Mailbox connected')
        router.refresh()
        return
      }

      stopPolling()

      if (res.status === 410) {
        toast.error('Connection session expired. Please try again.')
      } else if (res.status === 402) {
        toast.error(body?.message ?? 'Your plan does not allow another mailbox. Upgrade to add more.')
      } else {
        toast.error(body?.message ?? 'Connection failed. Please try again.')
      }
    } catch {
      // Transient network error — keep polling until the deadline elapses.
    }
  }

  async function startProvider(provider: Provider) {
    if (busy) return
    setBusy(provider)
    setOpen(false)
    setFallback(null)

    // Open the popup IMMEDIATELY, still inside the click gesture, BEFORE any
    // await. Measured on Safari default profile ("Block and notify"), private window :
    //   A  window.open synchronous, same-origin      → handle OK
    //   B  window.open after await fetch (471 ms)    → handle NULL
    //   C  window.open after await fetch (495 ms), off-origin → handle NULL
    // A is the positive control ; B and C differ from A only by the async
    // boundary. Any await after the click loses the user-activation token,
    // so window.open is refused. Opening about:blank first keeps the handle
    // alive without exposing a URL. The popup only leaves about:blank after
    // isAuthUrlSafe below has validated the destination.
    //
    // Two-step severance of window.opener, both necessary :
    //
    //   (1) `noopener` is DELIBERATELY NOT in the features string. Per HTML
    //       spec, `noopener` in window.open's features makes the call
    //       return null — the popup still opens, but our handle is null,
    //       so we cannot navigate it to the validated URL nor close it
    //       when the flow fails. The polling (sole writer of email_accounts
    //       on this path via /api/email-accounts/oauth/status/<sessionId>)
    //       needs the handle indirectly for the close-on-error and close-on-
    //       unmount hooks that keep tabs from leaking. Measured in Chromium :
    //         features with noopener        → handle null, popup blind to opener, close() impossible
    //         features without noopener     → handle OK,   popup SEES opener,     close() OK
    //         above + popup.opener = null   → handle OK,   popup blind to opener, close() OK
    //       Only the third gives us both properties.
    //
    //   (2) Right after open, sever the opener link explicitly. The
    //       assignment is same-origin at this instant (about:blank inherits
    //       our origin), so it never throws ; the null persists across the
    //       subsequent cross-origin navigation to the provider's hosted
    //       auth page via popup.location.replace(authUrl). This is what
    //       actually protects us from reverse-tabnabbing, NOT isAuthUrlSafe()
    //       — that helper validates the INITIAL URL only, not the OAuth
    //       redirect chain that follows.
    //
    // We still need the popup handle to close it in stopPolling and in the
    // useEffect cleanup when the parent unmounts mid-flow. Without a
    // handle, both leak an open window and orphan the poller.
    const features = 'width=500,height=600,resizable=yes,scrollbars=yes,status=yes'
    const popup = window.open('about:blank', 'oauth-connect-mailbox', features)
    if (popup) {
      try { popup.opener = null } catch { /* browser hardening : opener may be read-only ; the popup then still cannot use it as a foothold, we're not worse off */ }
      popupRef.current = popup
    }

    try {
      const res = await fetch('/api/email-accounts/oauth/init', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ provider }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.authUrl || !body?.sessionId) {
        if (popup) { try { popup.close() } catch { /* ignore */ } }
        popupRef.current = null
        toast.error(body?.message ?? 'Could not start the connection.')
        setBusy(null)
        return
      }

      if (!isAuthUrlSafe(provider, body.authUrl)) {
        if (popup) { try { popup.close() } catch { /* ignore */ } }
        popupRef.current = null
        toast.error('Connection refused: the provider returned an unexpected URL.')
        setBusy(null)
        return
      }

      // URL validated. From here it is safe to navigate the popup, and safe
      // to record the session so the poller (or the fallback link) can pick
      // it up. sessionRef and deadline are set on BOTH paths — nominal and
      // fallback — so a fallback-link click after the deadline hits
      // pollOnce's timeout branch (existing toast), which is the wanted
      // behaviour.
      const authUrl:   string = body.authUrl   as string
      const sessionId: string = body.sessionId as string
      sessionRef.current = sessionId
      deadline.current   = Date.now() + SESSION_TTL_MS

      if (!popup) {
        // Automatic navigation is off the table (browser refused the popup
        // above, e.g. Safari strict blocker). Surface a link the user can
        // click : a link click is a fresh gesture that goes where a
        // programmatic popup is refused. No toast — the card IS the
        // actionable UI. Release busy so the primary button is not stuck on
        // "Connecting…" without an out. Polling starts on the link click.
        setFallback({ provider, authUrl, sessionId })
        setBusy(null)
        return
      }

      try {
        popup.location.replace(authUrl)
      } catch {
        try { popup.close() } catch { /* ignore */ }
        popupRef.current = null
        setFallback({ provider, authUrl, sessionId })
        setBusy(null)
        return
      }

      pollTimer.current = setInterval(pollOnce, POLL_INTERVAL_MS)
      // First poll lands ~1.2s in so mock-mode success surfaces fast.
      setTimeout(pollOnce, 1200)
    } catch {
      if (popup) { try { popup.close() } catch { /* ignore */ } }
      popupRef.current = null
      toast.error('Could not start the connection. Please try again.')
      setBusy(null)
    }
  }

  // Fallback link click : the native anchor navigation opens the sign-in
  // tab (a link click is not a programmatic popup, so browsers allow it
  // where they refused window.open). We do NOT preventDefault. Our job
  // here is only to start the poller in parallel and clear the card.
  function onFallbackLinkClick() {
    const current = fallback
    if (!current) return
    setBusy(current.provider)
    if (pollTimer.current) clearInterval(pollTimer.current)
    pollTimer.current = setInterval(pollOnce, POLL_INTERVAL_MS)
    setTimeout(pollOnce, 1200)
    setFallback(null)
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={busy !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy !== null}
        className="inline-flex items-center gap-2 rounded-md border border-[#3b6bef] bg-white px-4 py-2 text-sm font-medium text-[#3b6bef] transition-colors hover:bg-[#3b6bef]/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <MailIcon />
        {busy ? 'Connecting…' : 'Connect your mailbox'}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Choose your mailbox provider"
          className="absolute right-0 z-10 mt-2 w-64 overflow-hidden rounded-md border border-[#e8e3dc] bg-white shadow-lg"
        >
          <ProviderOption
            ref={firstItemRef}
            label="Google Workspace"
            sub="OAuth · 30 seconds"
            onClick={() => startProvider('google')}
          />
          <ProviderOption
            label="Microsoft 365"
            sub="OAuth · 30 seconds"
            onClick={() => startProvider('microsoft')}
          />
          <p className="border-t border-[#e8e3dc] bg-[#faf8f4] px-3 py-2 text-[11px] text-[#4a4a5a]">
            Personal @gmail.com mailboxes are not supported.
          </p>
        </div>
      )}

      {fallback && (
        <div
          role="status"
          className="mt-2 rounded-md border border-[#e8e3dc] bg-[#faf8f4] p-3 text-sm"
        >
          <p className="text-[#4a4a5a]">The sign-in window didn&apos;t open.</p>
          <a
            href={fallback.authUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onFallbackLinkClick}
            className="mt-1.5 inline-block rounded-sm font-medium text-[#3b6bef] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2"
          >
            {fallback.provider === 'google' ? 'Open Google sign-in' : 'Open Microsoft sign-in'}
          </a>
        </div>
      )}
    </div>
  )
}

type ProviderOptionProps = {
  label: string
  sub:   string
  onClick: () => void
}

const ProviderOption = forwardRef<HTMLButtonElement, ProviderOptionProps>(
  function ProviderOption({ label, sub, onClick }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        role="menuitem"
        onClick={onClick}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-[#1a1a1a] hover:bg-[#f5f2ee] focus:bg-[#f5f2ee] focus:outline-none"
      >
        <span className="font-medium">{label}</span>
        <span className="text-[11px] text-[#4a4a5a]">{sub}</span>
      </button>
    )
  },
)

function MailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="3" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.5 4l5.5 4 5.5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
