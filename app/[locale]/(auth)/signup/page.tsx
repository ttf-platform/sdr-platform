'use client'
import { useState, Suspense, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/routing'
import { track } from '@/lib/track'
import { Turnstile } from '@marsidev/react-turnstile'
import { isAnalyticsAllowed } from '@/lib/cookie-consent'

// Keys we read from the sentra_utm localStorage record and forward to the
// signup API. Kept in sync with lib/schemas/auth.ts::acquisitionSchema —
// unknown keys are stripped server-side either way, but explicit filtering
// here avoids ever sending garbage over the wire.
const ACQUISITION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'referrer'] as const
const UTM_STORAGE_KEY = 'sentra_utm'

// Read the first-touch record synchronously (client-side only). Returns an
// object with only the known acquisition keys populated, or null if the
// record is missing / corrupt / user rejected analytics.
function readAcquisition(): Record<string, string> | null {
  if (typeof window === 'undefined') return null
  if (!isAnalyticsAllowed()) return null
  try {
    const raw = localStorage.getItem(UTM_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const key of ACQUISITION_KEYS) {
      const v = parsed[key]
      if (typeof v === 'string' && v.length > 0) out[key] = v
    }
    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null
  }
}

const PLAN_LABELS: Record<string, string> = { starter: 'Starter', pro: 'Pro', power: 'Power' }

function SignupForm() {
  const t = useTranslations('signup')
  const searchParams = useSearchParams()
  const planParam = searchParams.get('plan') ?? 'power'
  const plan = ['starter','pro','power'].includes(planParam) ? planParam : 'power'

  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [emailExists, setEmailExists] = useState(false)
  const [data, setData] = useState({ email: '', password: '', name: '', companyName: '' })
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  async function handleStep0(e: FormEvent) {
    e.preventDefault()
    if (!data.email || !data.password || !data.name) return
    setLoading(true)
    setError('')
    setEmailExists(false)
    try {
      const res = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email }),
      }).then(r => r.json())
      if (res.exists) {
        setEmailExists(true)
        setError(t('errorEmailExists'))
        setLoading(false)
        return
      }
      setStep(1)
    } catch {
      // Fail-open : erreur réseau/check ne doit pas bloquer ; le submit final re-valide.
      setStep(1)
    }
    setLoading(false)
  }

  async function handleFinish() {
    setLoading(true)
    setError('')
    const acquisition = readAcquisition()
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: data.email, password: data.password, name: data.name,
        companyName: data.companyName,
        plan_tier: plan,
        captchaToken,
        ...(acquisition ? { acquisition } : {}),
      })
    }).then(r => r.json())
    if (!res.success) {
      setError(res.message || res.error || t('somethingWentWrong'))
      setLoading(false)
      return
    }
    track('signup_completed', { plan })
    track('trial_started', { plan, auto: true })
    window.location.href = '/dashboard'
  }

  const steps = [t('step0'), t('step1')]

  return (
    <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-4 rounded-lg hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f2ee]">
            <div className="w-8 h-8 bg-[#1a1a2e] rounded-lg flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7L5.5 10.5L12 3.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <span className="text-lg font-bold text-[#1a1a2e]">Mir<span className="text-[#3b6bef]">vo</span></span>
          </Link>
          <div className="inline-flex items-center gap-1.5 bg-[#eef1fd] border border-[#dde6fd] text-[#3b6bef] text-xs font-semibold px-3 py-1.5 rounded-full mb-3">
            ✦ {t('trialBadge', { plan: PLAN_LABELS[plan] })}
          </div>
          <div className="flex items-center justify-center gap-2 mb-2">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={"w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors " + (i <= step ? 'bg-[#1a1a2e] text-white' : 'bg-[#e8e3dc] text-[#8a7e6e]')}>{i + 1}</div>
                {i < steps.length - 1 && <div className={"w-8 h-0.5 " + (i < step ? 'bg-[#1a1a2e]' : 'bg-[#e8e3dc]')}></div>}
              </div>
            ))}
          </div>
          <p className="text-sm text-[#8a7e6e]">{steps[step]}</p>
        </div>
        <div className="bg-white rounded-xl border border-[#e8e3dc] p-6 flex flex-col gap-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
              {error}
              {emailExists && (
                <div className="mt-2">
                  <Link href="/login" className="font-semibold text-red-600 underline">
                    {t('signIn')} instead →
                  </Link>
                </div>
              )}
            </div>
          )}
          {step === 0 && (
            <form onSubmit={handleStep0} className="contents">
              <h2 className="text-lg font-bold text-[#1a1a2e]">{t('step0Title')}</h2>
              <input type="text" name="name" autoComplete="name" value={data.name} onChange={e=>setData({...data,name:e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef]" placeholder={t('fullName')} />
              <input type="email" name="email" autoComplete="email" spellCheck={false} value={data.email} onChange={e=>setData({...data,email:e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef]" placeholder={t('email')} />
              <input type="password" name="new-password" autoComplete="new-password" value={data.password} onChange={e=>setData({...data,password:e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef]" placeholder={t('passwordPlaceholder')} minLength={8} />
              <button type="submit" disabled={!data.email||!data.password||!data.name||loading} className="w-full bg-[#1a1a2e] text-white rounded-lg min-h-[44px] py-2.5 text-sm font-medium disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2">{loading ? t('checking') : t('continue')}</button>
              <p className="text-center text-xs text-[#8a7e6e]">{t('alreadyHaveAccount')} <Link href="/login" className="text-[#3b6bef] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] rounded">{t('signIn')}</Link></p>
            </form>
          )}
          {step === 1 && (<>
            <h2 className="text-lg font-bold text-[#1a1a2e]">{t('companyStepTitle')}</h2>
            <input
              type="text"
              autoComplete="organization"
              value={data.companyName}
              onChange={e=>setData({...data,companyName:e.target.value})}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef]"
              placeholder={t('companyNamePlaceholder')}
            />
            <div className="flex justify-center">
              <Turnstile
                siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
                onSuccess={(token) => setCaptchaToken(token)}
                onError={() => setCaptchaToken(null)}
                onExpire={() => setCaptchaToken(null)}
                options={{ theme: 'light' }}
              />
            </div>
            <div className="flex gap-2">
              <button onClick={()=>setStep(0)} className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg min-h-[44px] py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2">{t('back')}</button>
              <button onClick={handleFinish} disabled={!data.companyName||loading||!captchaToken} className="flex-1 bg-[#1a1a2e] text-white rounded-lg min-h-[44px] py-2.5 text-sm font-medium disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2">{loading ? t('launching') : t('startTrial', { plan: PLAN_LABELS[plan] })}</button>
            </div>
          </>)}
        </div>
      </div>
    </div>
  )
}

export default function SignupPage() {
  const t = useTranslations('signup')
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center"><div className="text-sm text-[#8a7e6e]">{t('loading')}</div></div>}>
      <SignupForm />
    </Suspense>
  )
}
