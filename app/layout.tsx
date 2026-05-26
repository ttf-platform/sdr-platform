import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import './globals.css'
import { PHProvider } from './providers'
import { UTMCapture } from '@/components/UTMCapture'
import { CookieConsentBanner } from '@/components/CookieConsentBanner'

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  preload: true,
})

const BASE_URL = 'https://sentra.app'

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Sentra',
  url: BASE_URL,
  description: 'Cold outreach that books meetings. All-in-one outbound for founders and first sales hires.',
  logo: `${BASE_URL}/icon.svg`,
  sameAs: [],
}

export const metadata: Metadata = {
  title: 'Sentra — Cold outreach that books meetings',
  description:
    'Sentra finds your buyers, writes the email, books the meeting. All-in-one outbound for founders and first sales hires.',
  metadataBase: new URL(BASE_URL),
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Sentra — Cold outreach that books meetings',
    description:
      'Sentra finds your buyers, writes the email, books the meeting. All-in-one outbound for founders and first sales hires.',
    url: `${BASE_URL}/`,
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
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {supabaseUrl && <link rel="preconnect" href={supabaseUrl} />}
        <link rel="dns-prefetch" href="https://eu.i.posthog.com" />
        <link rel="dns-prefetch" href="https://challenges.cloudflare.com" />
      </head>
      <body className={dmSans.className}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <PHProvider>
          <UTMCapture />
          {children}
          <CookieConsentBanner />
        </PHProvider>
      </body>
    </html>
  )
}