import type { Metadata } from 'next'
import { Link } from '@/i18n/routing'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { LandingFooter } from '@/components/landing/LandingFooter'

export const metadata: Metadata = {
  title: 'Contact — Mirvo',
  description: 'Get in touch with the Mirvo team.',
  metadataBase: new URL('https://mirvo.ai'),
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'Contact — Mirvo',
    description: 'Get in touch with the Mirvo team.',
    url: 'https://mirvo.ai/contact',
    siteName: 'Mirvo',
    type: 'website',
  },
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('contact')
  const tc = await getTranslations('common')

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#faf8f5' }}>
      <LandingHeader />

      <nav className="mx-auto max-w-3xl px-6 pt-24 pb-0" aria-label="Breadcrumb">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-[#8a7e6e] hover:text-[#1a1a1a] transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2 rounded"
        >
          <span aria-hidden>←</span>
          <span>{tc('backHome')}</span>
        </Link>
      </nav>

      <main className="mx-auto max-w-3xl px-6 pt-8 pb-32 md:pb-40">
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
              href="mailto:hello@mirvo.ai"
              className="transition-opacity hover:opacity-70 inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2 rounded"
              style={{
                fontSize: '1.25rem',
                color: '#1a1a1a',
                textDecoration: 'underline',
                textUnderlineOffset: '4px',
                minHeight: '44px',
              }}
            >
              hello@mirvo.ai
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
