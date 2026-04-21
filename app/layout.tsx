import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SDR Platform - Autonomous B2B Outreach',
  description: 'Advanced cold outreach and lead qualification platform powered by AI',
  keywords: 'B2B, cold outreach, lead qualification, sales automation, SDR',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}