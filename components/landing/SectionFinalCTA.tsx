'use client';

import { Link } from '@/i18n/routing';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';

export function SectionFinalCTA() {
  const t = useTranslations('landing.finalCta');

  return (
    <section
      className="py-32 lg:py-40 px-6"
      style={{ backgroundColor: '#1a1a1a' }}
    >
      <div className="mx-auto max-w-3xl text-center">

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] as const }}
        >
          <h2
            className="font-medium text-white mx-auto"
            style={{
              fontSize: 'clamp(2.25rem, 5vw, 3.5rem)',
              lineHeight: 1.08,
              letterSpacing: '-0.02em',
              maxWidth: '30rem',
            }}
          >
            {t('headline')}
          </h2>

          <p
            className="mt-6 mx-auto"
            style={{
              fontSize: '1.0625rem',
              fontWeight: 300,
              lineHeight: 1.55,
              color: '#a8a8a8',
              maxWidth: '30rem',
            }}
          >
            {t('subtext')}
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-md px-7 py-3.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a1a] transition-opacity hover:opacity-90"
              style={{
                backgroundColor: '#ffffff',
                color: '#1a1a1a',
                fontWeight: 500,
                letterSpacing: '-0.01em',
              }}
            >
              {t('ctaPrimary')}
            </Link>
            <Link
              href="/#faq"
              className="inline-flex items-center justify-center rounded-md px-7 py-3.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a1a] transition-opacity hover:opacity-75"
              style={{
                color: '#a8a8a8',
                fontWeight: 300,
                border: '1px solid rgba(255,255,255,0.12)',
              }}
            >
              {t('ctaSecondary')}
            </Link>
          </div>

          <p
            className="mt-8"
            style={{ fontSize: '0.8125rem', fontWeight: 300, color: '#888888' }}
          >
            {t('note')}
          </p>
        </motion.div>

      </div>
    </section>
  );
}
