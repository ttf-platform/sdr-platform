import type { Metadata } from 'next'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { LandingFooter } from '@/components/landing/LandingFooter'

export const metadata: Metadata = {
  title: 'Contact — Sentra',
  description: 'Get in touch with the Sentra team.',
  metadataBase: new URL('https://sentra.app'),
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'Contact — Sentra',
    description: 'Get in touch with the Sentra team.',
    url: 'https://sentra.app/contact',
    siteName: 'Sentra',
    type: 'website',
  },
}

export default function ContactPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#faf8f5' }}>
      <LandingHeader />

      <main className="mx-auto max-w-3xl px-6 py-32 md:py-40">
        <h1
          className="mb-6 tracking-tight"
          style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 500, color: '#1a1a1a', lineHeight: 1.15 }}
        >
          Talk to us.
        </h1>

        <p
          className="mb-16 leading-relaxed"
          style={{ fontSize: '1.125rem', color: '#4a4a5a', maxWidth: '60ch' }}
        >
          Questions about the product, partnerships, press, or just want to share feedback? We read every message.
        </p>

        <div
          className="space-y-10"
          style={{ borderTop: '1px solid #e8e3dc', paddingTop: '3rem' }}
        >
          <div>
            <p
              className="mb-2 uppercase"
              style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: '#888888' }}
            >
              Email
            </p>
            <a
              href="mailto:hello@sentra.so"
              className="transition-opacity hover:opacity-70"
              style={{
                fontSize: '1.25rem',
                color: '#1a1a1a',
                textDecoration: 'underline',
                textUnderlineOffset: '4px',
              }}
            >
              hello@sentra.so
            </a>
          </div>

          <div>
            <p
              className="mb-2 uppercase"
              style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: '#888888' }}
            >
              Found a bug?
            </p>
            <p className="leading-relaxed" style={{ color: '#4a4a5a' }}>
              Existing users can report bugs directly from inside the app, under{' '}
              <span style={{ color: '#1a1a1a', fontWeight: 500 }}>Settings &rarr; Bug reports</span>.
            </p>
          </div>

          <div>
            <p
              className="mb-2 uppercase"
              style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: '#888888' }}
            >
              Press &amp; partnerships
            </p>
            <p className="leading-relaxed" style={{ color: '#4a4a5a' }}>
              Same email above. Expect a reply within 2 business days.
            </p>
          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
