'use client';

import { useTranslations } from 'next-intl';
import { CTAButton } from './CTAButton';
import { SectionEyebrow } from './SectionEyebrow';
import { Link } from '@/i18n/routing';

// Serialisable per-tier projection injected by the async Server Component
// parent (app/[locale]/page.tsx) after loadPlansConfig(). Kept minimal to
// avoid re-serialising the whole plans-config into the client bundle.
export type LandingPlansMap = Record<
  'starter' | 'pro' | 'power',
  {
    monthly_price_usd:           number | null
    annual_discount:             number | null
    prospects_sourced_per_month: number
    emails_per_month:            number
    enrichments_per_month:       number
  }
>

const PLAN_IDS: Array<'starter' | 'pro' | 'power'> = ['starter', 'pro', 'power']

export function PricingSection({ plans }: { plans: LandingPlansMap }) {
  const t = useTranslations('landing.pricing');

  const PLANS = PLAN_IDS.map((id) => {
    const c = plans[id]
    const monthly = c.monthly_price_usd ?? 0
    const yearly  = Math.round(monthly * 12 * (1 - (c.annual_discount ?? 0)))
    const isPro   = id === 'pro'
    return {
      id,
      name:        t(`${id}Name`),
      price:       t('monthlyPrice', { price: monthly }),
      annual:      t('annualPrice',  { price: yearly }),
      annualNote:  t('saveAnnual',   { pct: Math.round((c.annual_discount ?? 0.2) * 100) }),
      tagline:     t(`${id}Tagline`),
      features: [
        t('featProspects',   { count: c.prospects_sourced_per_month }),
        t('featEmails',      { count: c.emails_per_month }),
        t('featEnrichments', { count: c.enrichments_per_month }),
        t(`${id}F3`),
        t(`${id}F4`),
      ],
      highlighted: isPro,
      badge:       isPro ? t('proBadge') : null,
    }
  });

  return (
    <section id="pricing" className="py-24 bg-[#faf8f5]">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Section header */}
        <div className="text-center mb-16">
          <SectionEyebrow>{t('eyebrow')}</SectionEyebrow>
          <h2
            className="text-4xl lg:text-5xl font-light text-[#1a1a1a] mb-5 leading-tight"
            style={{ fontFamily: 'var(--font-fraunces)', fontStyle: 'italic' }}
          >
            {t('headline')}{' '}
            <span className="text-[#4a4a5a]">{t('headlineAccent')}</span>
          </h2>
          <p className="text-base lg:text-lg text-[#4a4a5a] max-w-xl mx-auto leading-relaxed">
            {t('subtext')}
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 items-start">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-2xl p-7 transition-all duration-200 ${
                plan.highlighted
                  ? 'border-2 border-[#3b6bef] bg-white shadow-xl shadow-blue-100/40 scale-[1.02] z-10'
                  : 'border border-[#e8e3dc] bg-white hover:shadow-md hover:border-[#d4cec7]'
              }`}
            >
              {/* Badge */}
              {plan.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-20">
                  <span className="inline-flex items-center rounded-full bg-[#3b6bef] px-3.5 py-1 text-[11px] font-semibold text-white shadow-sm shadow-blue-200">
                    {plan.badge}
                  </span>
                </div>
              )}

              {/* Plan name */}
              <div className="flex items-center justify-between mb-5">
                <span className="text-xs font-semibold uppercase tracking-widest text-[#9a9a9a]">
                  {plan.name}
                </span>
              </div>

              {/* Price */}
              <div className="mb-1 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-[#1a1a1a] tracking-tight">{plan.price}</span>
                <span className="text-sm text-[#9a9a9a] ml-0.5">{t('perMonth')}</span>
              </div>
              <div className="text-xs text-[#9a9a9a] mb-3">
                {t('annualOr')} {plan.annual} — {plan.annualNote}
              </div>

              {/* Tagline */}
              <p className="text-sm text-[#4a4a5a] mb-6 leading-relaxed border-b border-[#f0ebe4] pb-6">
                {plan.tagline}
              </p>

              {/* Features */}
              <ul className="space-y-2.5 mb-7">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-[#1a1a1a]">
                    <span
                      className={`mt-0.5 flex-shrink-0 h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                        plan.highlighted
                          ? 'bg-[#eff6ff] text-[#3b6bef]'
                          : 'bg-[#f5f2ee] text-[#4a4a5a]'
                      }`}
                    >
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <CTAButton
                href="/signup"
                variant={plan.highlighted ? 'primary' : 'secondary'}
                className="w-full justify-center"
              >
                {t('cta')}
              </CTAButton>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <div className="mt-10 text-center">
          <p className="text-sm text-[#9a9a9a]">
            {t('footerNote')}{' '}
            <Link
              href="/pricing"
              className="text-[#4a4a5a] underline underline-offset-2 hover:text-[#1a1a1a] transition-colors"
            >
              {t('footerLink')}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
