import { Fraunces } from 'next/font/google';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { Hero } from '@/components/landing/Hero';
import { TrustBand } from '@/components/landing/TrustBand';
import { SectionProblem } from '@/components/landing/SectionProblem';
import { SectionSolution } from '@/components/landing/SectionSolution';
import { SectionHowItWorks } from '@/components/landing/SectionHowItWorks';
import { PricingSection } from '@/components/landing/PricingSection';
import { SectionStackComparison } from '@/components/landing/SectionStackComparison';
import { SectionBuiltForFounders } from '@/components/landing/SectionBuiltForFounders';
import { SectionLimitsAndRoadmap } from '@/components/landing/SectionLimitsAndRoadmap';
import { SectionFAQ } from '@/components/landing/SectionFAQ';
import { SectionFinalCTA } from '@/components/landing/SectionFinalCTA';
import { LandingFooter } from '@/components/landing/LandingFooter';

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
  name: 'Sentra',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'All-in-one outbound platform for founders. Sentra finds your buyers, writes the email, and books the meeting.',
  url: 'https://sentra.app',
  offers: {
    '@type': 'AggregateOffer',
    priceCurrency: 'USD',
    lowPrice: '149',
    highPrice: '399',
    offerCount: 3,
  },
};

export default function LandingPage() {
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
