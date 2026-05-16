import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import './globals.css'
import { PHProvider } from './providers'

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  preload: true,
})

const BASE_URL = 'https://sentra.app'

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
  return (
    <html lang="en">
      <body className={dmSans.className}>
        <PHProvider>
          {children}
        </PHProvider>
      </body>
    </html>
  )
}