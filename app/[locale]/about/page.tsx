import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
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

export default async function AboutPage() {
  const t = await getTranslations('about')

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#faf8f5' }}>
      <LandingHeader />

      <main className="mx-auto max-w-3xl px-6 py-32 md:py-40">
        <h1
          className="mb-6 tracking-tight"
          style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 500, color: '#1a1a1a', lineHeight: 1.15 }}
        >
          {t('headline')}
        </h1>

        <p
          className="mb-16 leading-relaxed"
          style={{ fontSize: '1.125rem', color: '#4a4a5a', maxWidth: '60ch' }}
        >
          {t('subtext')}
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
              {t('principleTitle')}
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              {t('principleBody')}
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              {t('builtByTitle')}
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              {t('builtByBody')}
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              {t('getInTouchTitle')}
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a' }}>
              {t('getInTouchBody')}{' '}
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
