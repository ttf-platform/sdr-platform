import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
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

export default async function ContactPage() {
  const t = await getTranslations('contact')

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
          className="space-y-10"
          style={{ borderTop: '1px solid #e8e3dc', paddingTop: '3rem' }}
        >
          <div>
            <p
              className="mb-2 uppercase"
              style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: '#888888' }}
            >
              {t('emailLabel')}
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
              {t('bugLabel')}
            </p>
            <p className="leading-relaxed" style={{ color: '#4a4a5a' }}>
              {t('bugBody')}{' '}
              <span style={{ color: '#1a1a1a', fontWeight: 500 }}>{t('bugSettings')}</span>.
            </p>
          </div>

          <div>
            <p
              className="mb-2 uppercase"
              style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: '#888888' }}
            >
              {t('pressLabel')}
            </p>
            <p className="leading-relaxed" style={{ color: '#4a4a5a' }}>
              {t('pressBody')}
            </p>
          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
