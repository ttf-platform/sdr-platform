import type { Metadata } from 'next'
import Link from 'next/link'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { LandingFooter } from '@/components/landing/LandingFooter'

export const metadata: Metadata = {
  title: 'About — Sentra',
  description: 'Sentra builds autonomous cold outreach that books meetings, not noise.',
  metadataBase: new URL('https://sentra.app'),
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'About — Sentra',
    description: 'Sentra builds autonomous cold outreach that books meetings, not noise.',
    url: 'https://sentra.app/about',
    siteName: 'Sentra',
    type: 'website',
  },
}

export default function AboutPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#faf8f5' }}>
      <LandingHeader />

      <main className="mx-auto max-w-3xl px-6 py-32 md:py-40">
        <h1
          className="mb-6 tracking-tight"
          style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 500, color: '#1a1a1a', lineHeight: 1.15 }}
        >
          We build cold outreach that doesn&apos;t feel cold.
        </h1>

        <p
          className="mb-16 leading-relaxed"
          style={{ fontSize: '1.125rem', color: '#4a4a5a', maxWidth: '60ch' }}
        >
          Sentra is a B2B platform built for founders and revenue teams who want to scale outbound without sacrificing quality. Our agents research, write, and send like your best SDR — except they don&apos;t sleep.
        </p>

        <div
          className="space-y-12"
          style={{ borderTop: '1px solid #e8e3dc', paddingTop: '3rem' }}
        >
          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              The principle
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              Most &ldquo;AI outreach&rdquo; tools spray generic templates and burn sender reputations. We believe outbound only works when the message is genuinely relevant — and that&apos;s a research problem, not just a writing problem. Sentra solves both.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Built by
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              Sentra is built by Max, a founder operating from Montréal and Paris, with the help of Claude (Anthropic) as a daily technical collaborator. We&apos;re a small team intentionally — fewer cooks, more taste.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Get in touch
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a' }}>
              For partnerships, press, or product questions:{' '}
              <Link
                href="/contact"
                className="transition-opacity hover:opacity-70"
                style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}
              >
                /contact
              </Link>
            </p>
          </section>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
