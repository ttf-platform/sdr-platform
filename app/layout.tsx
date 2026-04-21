import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import './globals.css'

const dmSans = DM_Sans({ 
  subsets: ['latin'],
  weight: ['200', '300', '400', '500', '600', '700']
})

export const metadata: Metadata = {
  title: 'SDR Platform - Autonomous B2B Cold Outreach',
  description: 'Autonomous B2B cold outreach and lead qualification platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={dmSans.className}>
        {children}
      </body>
    </html>
  )
}