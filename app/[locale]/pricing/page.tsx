import type { Metadata } from 'next'
import { Link } from '@/i18n/routing'
import { getTranslations, setRequestLocale } from 'next-intl/server'

export const metadata: Metadata = {
  title: 'Pricing — Sentra',
  description: 'All plans include sourcing, writing, sending, deliverability, follow-ups, and meeting booking. Start free for 14 days — no credit card required.',
  metadataBase: new URL('https://sentra.app'),
  alternates: {
    canonical: '/pricing',
    languages: { en: '/en/pricing', fr: '/fr/pricing' },
  },
  openGraph: {
    title: 'Pricing — Sentra',
    description: 'Pick a plan. Start free. No surprises. From $149/mo — all plans include sourcing, writing, sending, and meeting booking.',
    url: 'https://sentra.app/pricing',
    siteName: 'Sentra',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pricing — Sentra',
    description: 'Pick a plan. Start free. No surprises. From $149/mo.',
  },
}

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('pricing')

  const PLANS = [
    {
      id: 'starter', name: t('starterName'), monthly: 149, yearly: 1430,
      features: [t('starterF0'),t('starterF1'),t('starterF2'),t('starterF3'),t('starterF4'),t('starterF5')],
      inherits: null,
    },
    {
      id: 'pro', name: t('proName'), monthly: 299, yearly: 2870, popular: true,
      features: [t('proF0'),t('proF1'),t('proF2'),t('proF3'),t('proF4'),t('proF5')],
      inherits: t('starterName'),
    },
    {
      id: 'power', name: t('powerName'), monthly: 399, yearly: 3830,
      features: [t('powerF0'),t('powerF1'),t('powerF2'),t('powerF3'),t('powerF4')],
      inherits: t('proName'),
    },
  ]

  const PRICING_FAQS = [
    { q: t('faq0q'), a: t('faq0a') },
    { q: t('faq1q'), a: t('faq1a') },
    { q: t('faq2q'), a: t('faq2a') },
    { q: t('faq3q'), a: t('faq3a') },
    { q: t('faq4q'), a: t('faq4a') },
    { q: t('faq5q'), a: t('faq5a') },
  ]

  const ALL_PLAN_FEATURES = [
    t('allF0'),t('allF1'),t('allF2'),t('allF3'),t('allF4'),t('allF5'),t('allF6'),t('allF7'),t('allF8'),
  ]
  return (
    <div className="min-h-screen bg-[#f5f2ee] font-sans">

      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-[#f0ece6]">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="font-bold text-[#1a1a2e] text-xl tracking-tight" translate="no">
            Sen<span className="text-[#3b6bef]">tra</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="inline-flex items-center min-h-[44px] text-sm text-[#6b5e4e] hover:text-[#1a1a2e] px-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]">{t('navLogin')}</Link>
            <Link href="/signup" className="bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2">
              {t('navStartTrial')}
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-16 pb-10 px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-4xl font-bold text-[#1a1a2e] mb-3">{t('headline')}</h1>
          <p className="text-lg text-[#4a4a5a] mb-4">{t('subtext')}</p>
          <div className="inline-flex flex-wrap items-center justify-center gap-1.5 bg-green-50 border border-green-200 text-green-800 text-sm font-semibold px-4 py-2 rounded-full text-center">
            🎉 {t('promoTextPre')} <span className="font-mono bg-green-100 px-1.5 py-0.5 rounded">{t('promoCode')}</span> {t('promoTextPost')}
          </div>
        </div>
      </section>

      {/* Solo plans */}
      <section className="pb-16 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider text-center mb-6">{t('soloPlansLabel')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-start">
            {PLANS.map(p => (
              <div key={p.id} className={`rounded-2xl border p-6 relative ${p.popular ? 'bg-[#1a1a2e] border-[#1a1a2e]' : 'bg-white border-[#e8e3dc]'}`}>
                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-[#3b6bef] text-white text-xs font-bold px-3 py-1 rounded-full">{t('mostPopular')}</span>
                  </div>
                )}
                <div className={`text-sm font-bold uppercase tracking-wider mb-2 ${p.popular ? 'text-[#8a9ab8]' : 'text-[#8a7e6e]'}`}>{p.name}</div>
                <div className={`text-4xl font-bold mb-0.5 ${p.popular ? 'text-white' : 'text-[#1a1a2e]'}`}>
                  ${p.monthly}<span className={`text-lg font-normal ${p.popular ? 'text-[#8a9ab8]' : 'text-[#8a7e6e]'}`}>{t('perMonth')}</span>
                </div>
                <div className={`text-xs mb-6 ${p.popular ? 'text-[#8a9ab8]' : 'text-[#8a7e6e]'}`}>
                  {t('orPerYear', { price: p.yearly })} <span className="text-green-400 font-semibold">{t('save20')}</span>
                </div>
                <ul className={`flex flex-col gap-2.5 mb-8 text-sm ${p.popular ? 'text-[#c8d4e8]' : 'text-[#4a4a5a]'}`}>
                  {p.inherits && (
                    <li className={`text-xs font-semibold mb-1 ${p.popular ? 'text-[#8a9ab8]' : 'text-[#8a7e6e]'}`}>
                      {t('everythingIn', { plan: p.inherits })}
                    </li>
                  )}
                  {p.features.map(f => (
                    <li key={f} className="flex items-center gap-2">
                      <span className={p.popular ? 'text-[#3b6bef]' : 'text-green-500'}>✓</span>{f}
                    </li>
                  ))}
                </ul>
                <Link href={`/signup?plan=${p.id}`}
                  className={`block text-center w-full rounded-xl min-h-[44px] py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2 ${
                    p.popular
                      ? 'bg-[#3b6bef] hover:bg-[#2a5bdf] text-white'
                      : 'border border-[#3b6bef] text-[#3b6bef] hover:bg-[#3b6bef] hover:text-white'
                  }`}>
                  {t('startFreeTrial')}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team / Corporate */}
      <section className="pb-16 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider text-center mb-6">{t('teamsLabel')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
            {[
              { name: t('teamName'), desc: t('teamDesc') },
              { name: t('corporateName'), desc: t('corporateDesc') },
            ].map(plan => (
              <div key={plan.name} className="bg-white border border-[#e8e3dc] rounded-2xl p-6 text-center">
                <div className="text-sm font-bold text-[#8a7e6e] uppercase tracking-wider mb-2">{plan.name}</div>
                <p className="text-sm text-[#4a4a5a] mb-6 leading-relaxed">{plan.desc}</p>
                <span className="inline-block border border-[#e8e3dc] text-[#6b5e4e] rounded-xl px-4 py-2 text-sm font-medium">
                  {t('contactSales')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison table note */}
      <section className="pb-10 px-6">
        <div className="max-w-3xl mx-auto bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-3">{t('allPlansLabel')}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4 text-sm text-[#4a4a5a]">
            {ALL_PLAN_FEATURES.map(f => (
              <div key={f} className="flex items-center gap-2"><span className="text-green-500">✓</span>{f}</div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="pb-20 px-6">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-[#1a1a2e] text-center mb-8">{t('faqTitle')}</h2>
          <div className="flex flex-col gap-3">
            {PRICING_FAQS.map((faq, i) => (
              <details key={i} className="group border border-[#e8e3dc] rounded-xl overflow-hidden">
                <summary className="flex items-center justify-between px-5 py-4 cursor-pointer bg-white hover:bg-[#faf8f5] text-sm font-semibold text-[#1a1a2e] list-none">
                  {faq.q}
                  <span className="text-[#8a7e6e] ml-4 text-lg group-open:rotate-45 transition-transform inline-block">+</span>
                </summary>
                <div className="px-5 pb-4 bg-white text-sm text-[#4a4a5a] leading-relaxed">{faq.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-[#1a1a2e] py-16 px-6 text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-4">{t('finalHeadline')}</h2>
          <p className="text-[#8a9ab8] mb-6">{t('finalSubtext')}</p>
          <Link href="/signup"
            className="inline-block bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-8 py-3.5 rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2">
            {t('finalCta')}
          </Link>
        </div>
      </section>

    </div>
  )
}
