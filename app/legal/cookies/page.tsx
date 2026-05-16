import type { Metadata } from 'next'
import Link from 'next/link'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { LandingFooter } from '@/components/landing/LandingFooter'

export const metadata: Metadata = {
  title: 'Cookie Policy — Sentra',
  description: 'How Sentra uses cookies and how to manage them.',
  metadataBase: new URL('https://sentra.app'),
  alternates: { canonical: '/legal/cookies' },
}

export default function CookiesPage() {
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
          Cookie Policy
        </h1>

        <div
          className="mb-12 rounded-lg"
          style={{ backgroundColor: '#f0ede8', border: '1px solid #e8e3dc', padding: '1rem 1.25rem' }}
        >
          <p style={{ fontSize: '0.875rem', color: '#4a4a5a', lineHeight: 1.6 }}>
            <strong style={{ color: '#1a1a1a' }}>Pre-launch placeholder.</strong> Sentra is currently in private beta. Our full, lawyer-reviewed cookie policy will be published before public launch. The page below describes our intended approach.
          </p>
        </div>

        <div className="space-y-10" style={{ borderTop: '1px solid #e8e3dc', paddingTop: '3rem' }}>
          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Functional cookies (auth &amp; preferences)
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              We use strictly necessary cookies to keep you logged in (Supabase session token) and remember your workspace preferences. These cookies cannot be disabled without breaking core functionality.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Analytics
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              We do not currently use third-party analytics cookies (no Google Analytics, no tracking pixels). If we add analytics in the future, we will update this policy and request consent where required.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Third-party cookies (Stripe checkout)
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              When you visit the billing or checkout pages, Stripe may set cookies for fraud prevention and payment flow continuity. These are governed by{' '}
              <a
                href="https://stripe.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-opacity hover:opacity-70"
                style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}
              >
                Stripe&apos;s privacy policy
              </a>
              .
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              How to manage cookies
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              You can clear cookies from your browser settings at any time. Note that clearing session cookies will log you out of Sentra. Most browsers also allow you to block third-party cookies by default.
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
