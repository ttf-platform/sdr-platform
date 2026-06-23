'use client'

/**
 * ConnectMailboxButton — OAuth mailbox connection (Sprint A1).
 *
 * Flow:
 *   1. User clicks the CTA → inline provider picker (Google / Microsoft)
 *   2. POST /api/email-accounts/oauth/init { provider }
 *      → opens window with returned authUrl (popup 500x600)
 *   3. Poll GET /api/email-accounts/oauth/status/{sessionId} every 5s
 *      → success: toast + router.refresh()
 *      → 410 expired / timeout 10min: toast.error
 *      → 409 gsuite_required / account_exists / provider_error: toast.error
 *
 * Design tokens: #3b6bef CTA, #1a1a1a head, #4a4a5a body, #e8e3dc border,
 * focus-visible rings. Secondary visual: outline button (vs the primary
 * "Add sending domain" link).
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

export function ConnectMailboxButton() {
  const router = useRouter()
  const [open, setOpen]       = useState(false)
  const [busy, setBusy]       = useState<Provider | null>(null)

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

    try {
      const res = await fetch('/api/email-accounts/oauth/init', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ provider }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.authUrl || !body?.sessionId) {
        toast.error(body?.message ?? 'Could not start the connection.')
        setBusy(null)
        return
      }

      if (!isAuthUrlSafe(provider, body.authUrl)) {
        toast.error('Connection refused: the provider returned an unexpected URL.')
        setBusy(null)
        return
      }

      // Open the provider's hosted auth page in a popup. `noopener` prevents
      // the popup from reaching back into the opener via window.opener.
      const features = 'width=500,height=600,resizable=yes,scrollbars=yes,status=yes,noopener'
      const popup = window.open(body.authUrl, 'oauth-connect-mailbox', features)
      if (!popup) {
        toast.error('Your browser blocked the popup. Please allow it and try again.')
        setBusy(null)
        return
      }
      popupRef.current   = popup
      sessionRef.current = body.sessionId as string
      deadline.current   = Date.now() + SESSION_TTL_MS

      pollTimer.current = setInterval(pollOnce, POLL_INTERVAL_MS)
      // First poll lands ~1.2s in so mock-mode success surfaces fast.
      setTimeout(pollOnce, 1200)
    } catch {
      toast.error('Could not start the connection. Please try again.')
      setBusy(null)
    }
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
