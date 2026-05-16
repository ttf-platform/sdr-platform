import type { Metadata } from 'next';
import { Fraunces } from 'next/font/google';
import { LandingHeader } from '@/components/landing/LandingHeader';

const fraunces = Fraunces({
  subsets: ['latin'],
  style: ['italic'],
  variable: '--font-fraunces',
  weight: ['300'],
  display: 'swap',
  preload: true,
});

const BASE_URL = 'https://sentra.app';

export const metadata: Metadata = {
  title: 'Sentra — Cold outreach that books meetings',
  description:
    'Sentra finds your buyers, writes the email, books the meeting. All-in-one outbound for founders and first sales hires.',
  metadataBase: new URL(BASE_URL),
  alternates: { canonical: '/landing-v2' },
  openGraph: {
    title: 'Sentra — Cold outreach that books meetings',
    description:
      'Sentra finds your buyers, writes the email, books the meeting. All-in-one outbound for founders and first sales hires.',
    url: `${BASE_URL}/landing-v2`,
    siteName: 'Sentra',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sentra — Cold outreach that books meetings',
    description:
      'All-in-one outbound for founders and first sales hires. Setup in under an hour.',
  },
  robots: { index: true, follow: true },
};

export default function LandingV2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${fraunces.variable} min-h-screen bg-[#faf8f5]`}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:bg-white focus:px-4 focus:py-2 focus:rounded focus:shadow-lg focus:text-[#2563eb] focus:outline-none"
      >
        Skip to main content
      </a>
      <LandingHeader />
      <main id="main-content">{children}</main>
    </div>
  );
}
