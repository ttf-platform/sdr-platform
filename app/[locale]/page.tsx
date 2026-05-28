import type { Metadata } from 'next'
import { Fraunces } from 'next/font/google';
import { setRequestLocale } from 'next-intl/server';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { Hero } from '@/components/landing/Hero';
import { TrustBand } from '@/components/landing/TrustBand';
import { SectionProblem } from '@/components/landing/SectionProblem';
import { SectionSolution } from '@/components/landing/SectionSolution';
import { SectionHowItWorks } from '@/components/landing/SectionHowItWorks';
import { SectionSignals } from '@/components/landing/SectionSignals';
import { PricingSection } from '@/components/landing/PricingSection';
import { SectionStackComparison } from '@/components/landing/SectionStackComparison';
import { SectionBuiltForFounders } from '@/components/landing/SectionBuiltForFounders';
import { SectionLimitsAndRoadmap } from '@/components/landing/SectionLimitsAndRoadmap';
import { SectionFAQ } from '@/components/landing/SectionFAQ';
import { SectionFinalCTA } from '@/components/landing/SectionFinalCTA';
import { LandingFooter } from '@/components/landing/LandingFooter';

export const metadata: Metadata = {
  title: 'Mirvo — Cold outreach that books meetings',
  description: 'Mirvo finds your buyers and drafts the emails. You approve. Meetings land on your calendar. From $149/mo — no salary, no benefits, no 6-week ramp.',
  metadataBase: new URL('https://mirvo.ai'),
  alternates: {
    canonical: '/',
    languages: { en: '/en', fr: '/fr' },
  },
  openGraph: {
    title: 'Mirvo — Cold outreach that books meetings',
    description: 'Mirvo finds your buyers and drafts the emails. You approve. Meetings land on your calendar. From $149/mo — no salary, no benefits, no 6-week ramp.',
    url: 'https://mirvo.ai',
    siteName: 'Mirvo',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mirvo — Cold outreach that books meetings',
    description: 'Your first hire. Without the headcount. Mirvo finds your buyers, writes the emails, books the meetings.',
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
    'All-in-one outbound platform for founders. Mirvo finds your buyers, writes the email, and books the meeting.',
  url: 'https://mirvo.ai',
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
  return (
    <div className={`${fraunces.variable} min-h-screen bg-[#faf8f5]`}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:bg-white focus:px-4 focus:py-2 focus:rounded focus:shadow-lg focus:text-[#2563eb] focus:outline-none"
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
        <PricingSection />
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
