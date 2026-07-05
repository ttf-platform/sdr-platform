'use client';

import { Link } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { LocaleSwitcher } from '@/components/i18n/LocaleSwitcher';

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <p
        className="mb-4 uppercase text-white"
        style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.14em' }}
      >
        {heading}
      </p>
      <ul className="space-y-3">
        {links.map(({ label, href }) => (
          <li key={label}>
            <Link
              // eslint-disable-next-line
              href={href as any}
              className="text-[#888888] hover:text-[#c0c0c0] transition-colors"
              style={{ fontSize: '0.875rem', fontWeight: 300 }}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LandingFooter() {
  const t = useTranslations('landing.footer');

  return (
    <footer id="footer" style={{ backgroundColor: '#1a1a1a' }}>
      <div
        className="mx-auto max-w-6xl px-6 lg:px-8 py-16 lg:py-20"
        style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 md:gap-8 lg:gap-12">

          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <span
                className="flex items-center justify-center rounded"
                style={{
                  width: 28,
                  height: 28,
                  backgroundColor: '#3b6bef',
                  fontSize: '0.8125rem',
                  fontWeight: 700,
                  color: '#ffffff',
                  letterSpacing: '-0.01em',
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                S
              </span>
              <span
                className="text-white"
                style={{ fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.01em' }}
                translate="no"
              >
                Mirvo
              </span>
            </div>
            <p
              className="text-[#888888]"
              style={{ fontSize: '0.875rem', fontWeight: 300, lineHeight: 1.55, maxWidth: '18rem' }}
            >
              {t('tagline')}
            </p>

            {/* Status */}
            <div className="mt-6 flex items-center gap-2">
              <span
                className="motion-safe:animate-pulse rounded-full"
                style={{ width: 7, height: 7, backgroundColor: '#22c55e', flexShrink: 0 }}
                aria-hidden="true"
              />
              <span style={{ fontSize: '0.8125rem', fontWeight: 300, color: '#888888' }}>
                {t('statusText')}
              </span>
            </div>
          </div>

          {/* Product */}
          <FooterColumn
            heading={t('productHeading')}
            links={[
              { label: t('productFeatures'),  href: '/#features' },
              { label: t('productPricing'),   href: '/#pricing' },
              { label: t('productRoadmap'),   href: '/#roadmap' },
              { label: t('productChangelog'), href: '/changelog' },
            ]}
          />

          {/* Company */}
          <FooterColumn
            heading={t('companyHeading')}
            links={[
              { label: t('companyAbout'),   href: '/about' },
              { label: t('companyBlog'),    href: '/blog' },
              { label: t('companyCareers'), href: '/careers' },
              { label: t('companyContact'), href: 'mailto:hello@mirvo.ai' },
            ]}
          />

          {/* Legal */}
          <FooterColumn
            heading={t('legalHeading')}
            links={[
              { label: t('legalPrivacy'), href: '/legal/privacy' },
              { label: t('legalTerms'),   href: '/legal/terms' },
              { label: t('legalCookies'), href: '/legal/cookies' },
              { label: t('legalGdpr'),    href: '/legal/gdpr' },
            ]}
          />
        </div>

        {/* Bottom bar */}
        <div
          className="mt-12 pt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <p style={{ fontSize: '0.8125rem', fontWeight: 300, color: '#888888' }}>
            {t('copyright')}
          </p>
          <div className="flex items-center gap-4">
            <LocaleSwitcher />
            <p style={{ fontSize: '0.8125rem', fontWeight: 300, color: '#888888' }}>
              {t('footerTagline')}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
