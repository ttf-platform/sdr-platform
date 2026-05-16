import type { Metadata } from 'next'
import Link from 'next/link'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { LandingFooter } from '@/components/landing/LandingFooter'

export const metadata: Metadata = {
  title: 'GDPR Rights — Sentra',
  description: 'Your rights under GDPR and how to exercise them.',
  metadataBase: new URL('https://sentra.app'),
  alternates: { canonical: '/legal/gdpr' },
}

export default function GdprPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#faf8f5' }}>
      <LandingHeader />

      <main className="mx-auto max-w-3xl px-6 py-32 md:py-40">
        <p
          className="mb-4 uppercase"
          style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: '#888888' }}
        >
          Legal
        </p>
        <h1
          className="mb-6 tracking-tight"
          style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 500, color: '#1a1a1a', lineHeight: 1.15 }}
        >
          GDPR Rights
        </h1>

        <div
          className="mb-12 rounded-lg"
          style={{ backgroundColor: '#f0ede8', border: '1px solid #e8e3dc', padding: '1rem 1.25rem' }}
        >
          <p style={{ fontSize: '0.875rem', color: '#4a4a5a', lineHeight: 1.6 }}>
            <strong style={{ color: '#1a1a1a' }}>Pre-launch placeholder.</strong> Sentra is currently in private beta. Our full, lawyer-reviewed GDPR documentation will be published before public launch. The page below describes our intended approach.
          </p>
        </div>

        <div className="space-y-10" style={{ borderTop: '1px solid #e8e3dc', paddingTop: '3rem' }}>
          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Right of access (Art. 15)
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              You can request a full export of all personal data Sentra holds about you, including account details, workspace content, and usage logs.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Right to rectification (Art. 16)
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              You can correct inaccurate personal data directly from your account settings, or contact us for corrections that require manual intervention.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Right to erasure (Art. 17)
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              You can request deletion of your account and all associated data. We apply a 30-day soft-delete grace period before permanent deletion, during which you can restore your account.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Right to data portability (Art. 20)
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              You can export your campaigns, prospects, and email history in machine-readable format (CSV or JSON) at any time from within the app.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Right to object (Art. 21)
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              You can object to processing of your personal data for direct marketing or profiling at any time. Contact us to exercise this right.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              How to exercise these rights
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              Email us at{' '}
              <a
                href="mailto:hello@sentra.so"
                className="transition-opacity hover:opacity-70"
                style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}
              >
                hello@sentra.so
              </a>{' '}
              with the subject line &ldquo;GDPR Request&rdquo; and we will respond within 30 days, as required by law. Or use the{' '}
              <Link
                href="/contact"
                className="transition-opacity hover:opacity-70"
                style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}
              >
                contact page
              </Link>
              .
            </p>
          </section>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
