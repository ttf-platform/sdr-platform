import type { Metadata } from 'next'
import { Link } from '@/i18n/routing'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { LandingFooter } from '@/components/landing/LandingFooter'

export const metadata: Metadata = {
  title: 'About — Mirvo',
  description: 'Mirvo builds autonomous cold outreach that books meetings, not noise.',
  metadataBase: new URL('https://www.mirvo.ai'),
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'About — Mirvo',
    description: 'Mirvo builds autonomous cold outreach that books meetings, not noise.',
    url: 'https://www.mirvo.ai/about',
    siteName: 'Mirvo',
    type: 'website',
  },
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('about')
  const tc = await getTranslations('common')

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#faf8f5' }}>
      <LandingHeader />

      <nav className="mx-auto max-w-3xl px-6 pt-24 pb-0" aria-label="Breadcrumb">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-[#8a7e6e] hover:text-[#1a1a1a] transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2 rounded"
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
