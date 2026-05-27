'use client'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/routing'
import { createBrowserClient } from '@supabase/ssr'

function ResetPasswordForm() {
  const t            = useTranslations('resetPassword')
  const searchParams = useSearchParams()

  // Per-component client — avoids shared module-level session state
  const supabase = useRef(
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  ).current

  const [sessionReady, setSessionReady] = useState(false)
  const [password,     setPassword]     = useState('')
  const [confirm,      setConfirm]      = useState('')
  const [submitting,   setSubmitting]   = useState(false)
  const [success,      setSuccess]      = useState(false)
  const [error,        setError]        = useState('')
  const verified = useRef(false)

  useEffect(() => {
    if (verified.current) return  // StrictMode guard — only verify once
    verified.current = true

    const token_hash = searchParams.get('token_hash')
    const type       = searchParams.get('type')

    if (!token_hash || type !== 'recovery') {
      setError(t('errorInvalidLink'))
      return
    }

    supabase.auth.verifyOtp({ token_hash, type: 'recovery' })
      .then(({ error: err }) => {
        if (err) setError(t('errorInvalidLink'))
        else     setSessionReady(true)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handle(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError(t('errorTooShort')); return }
    if (password !== confirm) { setError(t('errorMismatch')); return }
    setSubmitting(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (err) { setError(err.message); return }
    setSuccess(true)
  }

  if (success) {
    return (
      <div className="bg-white rounded-xl border border-[#e8e3dc] p-6 text-center flex flex-col gap-4">
        <div className="text-3xl">✅</div>
        <div>
          <p className="font-semibold text-[#1a1a2e]">{t('successTitle')}</p>
          <p className="text-sm text-[#8a7e6e] mt-1">{t('successSub')}</p>
        </div>
        <Link href="/login" className="w-full inline-block bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium text-center hover:bg-[#2a2a3e] transition-colors">
          {t('goToLogin')}
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-[#e8e3dc] p-6 flex flex-col gap-4">
      {error && (
        <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">
          {error}
          {error === t('errorInvalidLink') && (
            <span> <Link href="/forgot-password" className="underline font-medium">Request a new link</Link>.</span>
          )}
        </div>
      )}

      {!sessionReady && !error && (
        <p className="text-sm text-[#8a7e6e] text-center py-2">Verifying reset link…</p>
      )}

      {sessionReady && (
        <form onSubmit={handle} className="flex flex-col gap-4">
          <div>
            <label className="sr-only" htmlFor="rp-password">{t('newPassword')}</label>
            <input
              id="rp-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef]"
              placeholder={t('newPassword')}
              required
              minLength={8}
            />
          </div>
          <div>
            <label className="sr-only" htmlFor="rp-confirm">{t('confirmPassword')}</label>
            <input
              id="rp-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef]"
              placeholder={t('confirmPassword')}
              required
              minLength={8}
            />
          </div>
          <button
            type="submit"
            disabled={submitting || password.length < 8}
            className="w-full bg-[#1a1a2e] text-white rounded-lg min-h-[44px] py-2.5 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2"
          >
            {submitting ? t('submitting') : t('submit')}
          </button>
        </form>
      )}

      {!error && (
        <p className="text-center text-xs text-[#8a7e6e]">
          <Link href="/login" className="text-[#3b6bef] font-medium">{t('backToLogin')}</Link>
        </p>
      )}
    </div>
  )
}

export default function ResetPasswordPage() {
  const t = useTranslations('resetPassword')
  return (
    <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-[#1a1a2e] rounded-lg flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7L5.5 10.5L12 3.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <span className="text-lg font-bold text-[#1a1a2e]">Mir<span className="text-[#3b6bef]">vo</span></span>
          </div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">{t('title')}</h1>
        </div>
        <Suspense fallback={<div className="bg-white rounded-xl border border-[#e8e3dc] p-6 text-center text-sm text-[#8a7e6e]">Loading…</div>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  )
}
