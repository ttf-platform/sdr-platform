import type { Metadata } from 'next'
import Link from 'next/link'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { LandingFooter } from '@/components/landing/LandingFooter'

export const metadata: Metadata = {
  title: 'Terms of Service — Sentra',
  description: 'Terms governing your use of the Sentra platform.',
  metadataBase: new URL('https://sentra.app'),
  alternates: { canonical: '/legal/terms' },
}

export default function TermsPage() {
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
          Terms of Service
        </h1>

        <div
          className="mb-12 rounded-lg"
          style={{ backgroundColor: '#f0ede8', border: '1px solid #e8e3dc', padding: '1rem 1.25rem' }}
        >
          <p style={{ fontSize: '0.875rem', color: '#4a4a5a', lineHeight: 1.6 }}>
            <strong style={{ color: '#1a1a1a' }}>Pre-launch placeholder.</strong> Sentra is currently in private beta. Our full, lawyer-reviewed terms of service will be published before public launch. The page below describes our intended approach.
          </p>
        </div>

        <div className="space-y-10" style={{ borderTop: '1px solid #e8e3dc', paddingTop: '3rem' }}>
          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              What Sentra does
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              Sentra is a B2B outbound automation platform. We provide tools to research prospects, generate personalized outreach emails, and track replies. You own your data and campaigns.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Your account
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              You are responsible for keeping your credentials secure and for all activity under your account. One workspace per subscription unless otherwise arranged.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Acceptable use
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              You agree not to use Sentra to send spam, violate CAN-SPAM or GDPR regulations, harass recipients, or scrape data for resale. We reserve the right to suspend accounts that generate abnormal bounce rates or abuse reports.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Termination
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              You can cancel at any time from the billing settings. We may suspend access for non-payment or policy violations. Data is retained for 30 days after cancellation before permanent deletion.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Liability
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              Sentra is provided as-is during the beta period. We are not liable for deliverability outcomes, replies, or business results from outreach campaigns. Our liability is limited to the subscription amount paid in the prior month.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Changes to terms
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              We will notify users by email at least 14 days before any material change to these terms. Continued use after the effective date constitutes acceptance.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Questions?
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a' }}>
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
