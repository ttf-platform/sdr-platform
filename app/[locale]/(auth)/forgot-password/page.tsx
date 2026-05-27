'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/routing'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function ForgotPasswordPage() {
  const t = useTranslations('forgotPassword')
  const [email, setEmail]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError]       = useState('')

  async function handle(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const origin = window.location.origin
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${origin}/reset-password`,
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setSubmitted(true)
  }

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
          {!submitted && <p className="text-sm text-[#8a7e6e] mt-1">{t('sub')}</p>}
        </div>

        {submitted ? (
          <div className="bg-white rounded-xl border border-[#e8e3dc] p-6 text-center flex flex-col gap-4">
            <div className="text-3xl">📬</div>
            <div>
              <p className="font-semibold text-[#1a1a2e]">{t('successTitle')}</p>
              <p className="text-sm text-[#8a7e6e] mt-1">{t('successSub')}</p>
            </div>
            <Link href="/login" className="text-sm text-[#3b6bef] font-medium hover:underline">{t('backToLogin')}</Link>
          </div>
        ) : (
          <form onSubmit={handle} className="bg-white rounded-xl border border-[#e8e3dc] p-6 flex flex-col gap-4">
            {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
            <div>
              <label className="sr-only" htmlFor="fp-email">{t('emailPlaceholder')}</label>
              <input
                id="fp-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef]"
                placeholder={t('emailPlaceholder')}
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#1a1a2e] text-white rounded-lg min-h-[44px] py-2.5 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2"
            >
              {loading ? t('submitting') : t('submit')}
            </button>
            <p className="text-center text-xs text-[#8a7e6e]">
              <Link href="/login" className="text-[#3b6bef] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] rounded">{t('backToLogin')}</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
