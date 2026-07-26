import type { Metadata } from 'next'
import { Fraunces } from 'next/font/google';
import { setRequestLocale } from 'next-intl/server';
import { loadPlansConfig } from '@/lib/plans';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { Hero } from '@/components/landing/Hero';
import { TrustBand } from '@/components/landing/TrustBand';
import { SectionProblem } from '@/components/landing/SectionProblem';
import { SectionSolution } from '@/components/landing/SectionSolution';
import { SectionHowItWorks } from '@/components/landing/SectionHowItWorks';
import { SectionSignals } from '@/components/landing/SectionSignals';
import { PricingSection, type LandingPlansMap } from '@/components/landing/PricingSection';
import { SectionStackComparison } from '@/components/landing/SectionStackComparison';
import { SectionBuiltForFounders } from '@/components/landing/SectionBuiltForFounders';
import { SectionLimitsAndRoadmap } from '@/components/landing/SectionLimitsAndRoadmap';
import { SectionFAQ } from '@/components/landing/SectionFAQ';
import { SectionFinalCTA } from '@/components/landing/SectionFinalCTA';
import { LandingFooter } from '@/components/landing/LandingFooter';

// ISR — landing stays statically served from the CDN, and any /admin/plans
// edit surfaces on the next request past this window. Not force-dynamic
// on purpose : landing traffic is public + high-QPS, and the plans-config
// table changes on human cadence, not per-request. Same cadence as
// /pricing (PR4b) so the two public pages stay coherent.
export const revalidate = 60

export const metadata: Metadata = {
  title: 'Mirvo: cold outreach you control',
  description: 'Mirvo finds the right people, drafts a real email for each one, and never sends anything you haven\'t approved. From $149/mo, no salary, no 6-week ramp.',
  metadataBase: new URL('https://www.mirvo.ai'),
  alternates: {
    canonical: '/',
    languages: { en: '/en', fr: '/fr' },
  },
  openGraph: {
    title: 'Mirvo: cold outreach you control',
    description: 'Mirvo finds the right people, drafts a real email for each one, and never sends anything you haven\'t approved. From $149/mo, no salary, no 6-week ramp.',
    url: 'https://www.mirvo.ai',
    siteName: 'Mirvo',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mirvo: cold outreach you control',
    description: 'Mirvo finds the right people, writes each email for them, and waits for your approval before anything sends.',
  },
}

const fraunces = Fraunces({
  subsets: ['latin'],
  style: ['italic'],
  variable: '--font-fraunces',
  weight: ['300'],
  display: 'swap',
  preload: true,
});

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Mirvo',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'All-in-one outbound platform for small teams. Mirvo finds the right people, drafts each email, and sends only what you approve.',
  url: 'https://www.mirvo.ai',
  offers: {
    '@type': 'AggregateOffer',
    priceCurrency: 'USD',
    lowPrice: '149',
    highPrice: '399',
    offerCount: 3,
  },
};

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  // Source of truth = table plans. loadPlansConfig falls back to seed on
  // any error, so the landing keeps rendering even if the DB is unreachable.
  const cfg = await loadPlansConfig()
  const plans: LandingPlansMap = (['starter', 'pro', 'power'] as const).reduce((acc, t) => {
    acc[t] = {
      monthly_price_usd:           cfg[t].monthly_price_usd,
      annual_discount:             cfg[t].annual_discount,
      prospects_sourced_per_month: cfg[t].prospects_sourced_per_month,
      emails_per_month:            cfg[t].emails_per_month,
      enrichments_per_month:       cfg[t].enrichments_per_month,
    }
    return acc
  }, {} as LandingPlansMap)
  return (
    <div className={`${fraunces.variable} min-h-screen bg-[#faf8f5]`}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:bg-white focus:px-4 focus:py-2 focus:rounded focus:shadow-lg focus:text-[#3b6bef] focus:outline-none"
      >
        Skip to main content
      </a>
      <LandingHeader />
      <main id="main-content">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <Hero />
        <TrustBand />
        <SectionProblem />
        <SectionSolution />
        <SectionHowItWorks />
        <SectionSignals />
        <PricingSection plans={plans} />
        <SectionStackComparison />
        <SectionBuiltForFounders />
        <SectionLimitsAndRoadmap />
        <SectionFAQ />
        <SectionFinalCTA />
        <LandingFooter />
      </main>
    </div>
  );
}
