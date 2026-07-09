import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import './globals.css'
import { PHProvider } from './providers'
import { UTMCapture } from '@/components/UTMCapture'

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  preload: true,
})

const BASE_URL = 'https://mirvo.ai'

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Mirvo',
  url: BASE_URL,
  description: 'Cold outreach that books meetings. All-in-one outbound for founders and first sales hires.',
  logo: `${BASE_URL}/icon.svg`,
  sameAs: [],
}

export const metadata: Metadata = {
  title: 'Mirvo — Cold outreach that books meetings',
  description:
    'Mirvo finds your buyers, writes the email, books the meeting. All-in-one outbound for founders and first sales hires.',
  metadataBase: new URL(BASE_URL),
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Mirvo — Cold outreach that books meetings',
    description:
      'Mirvo finds your buyers, writes the email, books the meeting. All-in-one outbound for founders and first sales hires.',
    url: `${BASE_URL}/`,
    siteName: 'Mirvo',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mirvo — Cold outreach that books meetings',
    description:
      'All-in-one outbound for founders and first sales hires. Send from your own inbox on day one.',
  },
  robots: { index: true, follow: true },
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/apple-icon.png' },
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
      </head>
      <body className={dmSans.className}>
        <PHProvider>
          <UTMCapture />
          {children}
        </PHProvider>
      </body>
    </html>
  )
}