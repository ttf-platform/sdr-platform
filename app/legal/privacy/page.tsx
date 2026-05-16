import type { Metadata } from 'next'
import Link from 'next/link'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { LandingFooter } from '@/components/landing/LandingFooter'

export const metadata: Metadata = {
  title: 'Privacy Policy — Sentra',
  description: 'How Sentra handles your data.',
  metadataBase: new URL('https://sentra.app'),
  alternates: { canonical: '/legal/privacy' },
}

export default function PrivacyPage() {
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
          Privacy Policy
        </h1>

        <div
          className="mb-12 rounded-lg"
          style={{ backgroundColor: '#f0ede8', border: '1px solid #e8e3dc', padding: '1rem 1.25rem' }}
        >
          <p style={{ fontSize: '0.875rem', color: '#4a4a5a', lineHeight: 1.6 }}>
            <strong style={{ color: '#1a1a1a' }}>Pre-launch placeholder.</strong> Sentra is currently in private beta. Our full, lawyer-reviewed privacy policy will be published before public launch. The page below describes our intended approach.
          </p>
        </div>

        <div className="space-y-10" style={{ borderTop: '1px solid #e8e3dc', paddingTop: '3rem' }}>
          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              What we collect
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              Account information (email, name), workspace data you create (campaigns, prospects, emails), and product usage analytics. We don&apos;t sell or share your data with marketers.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Third-party processors
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              Supabase (database &amp; auth), Vercel (hosting), Anthropic (AI generation), Resend (transactional emails), Stripe (billing), Instantly (outbound email delivery). Each processor has its own privacy policy and data-processing agreements.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Your rights (GDPR &amp; CCPA)
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              You can request access, export, or deletion of your data at any time. Soft-delete with 30-day grace period before permanent deletion.
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
              For specific questions in the meantime:{' '}
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
