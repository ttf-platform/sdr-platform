'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/routing'
import { createClient } from '@/lib/supabase/client'
import { track } from '@/lib/track'

const supabase = createClient()

export default function LoginPage() {
  const t = useTranslations('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handle(e: any) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    track('login_completed')
    window.location.href = '/dashboard'
  }

  return (
    <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-[#1a1a2e] rounded-lg flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7L5.5 10.5L12 3.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <span className="text-lg font-bold text-[#1a1a2e]">Sen<span className="text-[#3b6bef]">tra</span></span>
          </div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">{t('welcomeBack')}</h1>
        </div>
        <form onSubmit={handle} className="bg-white rounded-xl border border-[#e8e3dc] p-6 flex flex-col gap-4">
          {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
          <div>
            <label className="sr-only" htmlFor="login-email">{t('emailPlaceholder')}</label>
            <input id="login-email" type="email" name="email" autoComplete="email" spellCheck={false} value={email} onChange={e=>setEmail(e.target.value)} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef]" placeholder={t('emailPlaceholder')} required />
          </div>
          <div>
            <label className="sr-only" htmlFor="login-password">{t('passwordPlaceholder')}</label>
            <input id="login-password" type="password" name="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef]" placeholder={t('passwordPlaceholder')} required />
          </div>
          <button type="submit" disabled={loading} className="w-full bg-[#1a1a2e] text-white rounded-lg min-h-[44px] py-2.5 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2">
            {loading ? t('signingIn') : t('signIn')}
          </button>
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#8a7e6e]">{t('noAccount')} <Link href="/signup" className="text-[#3b6bef] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] rounded">{t('signUp')}</Link></p>
            <Link href="/forgot-password" className="text-xs text-[#8a7e6e] hover:text-[#3b6bef] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] rounded">{t('forgotPassword')}</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
