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
    <>
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
    </>
  );
}
