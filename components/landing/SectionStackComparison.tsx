'use client';

import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { CTAButton } from './CTAButton';

// ─── Bullet list sub-component ────────────────────────────────────────────────

function BulletList({
  items,
  type,
  featured = false,
}: {
  items: string[];
  type: 'pro' | 'con';
  featured?: boolean;
}) {
  const icon = type === 'pro' ? '✓' : '✗';
  const iconColor = featured && type === 'pro' ? '#2563eb' : '#9a9a9a';
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item} className="flex items-baseline gap-2">
          <span
            aria-hidden="true"
            className="flex-shrink-0 text-[10px]"
            style={{ fontWeight: 700, color: iconColor, lineHeight: '1.5rem' }}
          >
            {icon}
          </span>
          <span className="text-[0.875rem] leading-[1.45] text-[#1a1a1a]" style={{ fontWeight: 300 }}>
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

export function SectionStackComparison() {
  const t = useTranslations('landing.stackComparison');

  return (
    <section className="bg-[#f5f2ee] py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-6 lg:px-8">

        {/* Section header */}
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const }}
        >
          <p
            className="mb-5 font-bold uppercase text-[#2563eb]"
            style={{ fontSize: '0.625rem', letterSpacing: '0.18em' }}
          >
            {t('eyebrow')}
          </p>
          <h2
            className="mb-4 font-medium text-[#1a1a1a] mx-auto"
            style={{
              fontSize: 'clamp(2rem, 4.5vw, 3rem)',
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
              maxWidth: '52rem',
            }}
          >
            {t('headline')}
          </h2>
          <p
            className="text-[1.0625rem] leading-[1.5] text-[#4a4a5a] mx-auto"
            style={{ fontWeight: 300, maxWidth: '42rem' }}
          >
            {t('subtext')}
          </p>
        </motion.div>

        {/* 3-card grid — Sentra last on mobile (source order), right on desktop */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8 items-start">

          {/* Card 1 — Assemble a stack */}
          <motion.article
            className="rounded-lg bg-white border border-[#e8e3dc] p-8"
            style={{ boxShadow: '0 1px 3px rgba(26,26,26,0.06), 0 1px 2px -1px rgba(26,26,26,0.06)' }}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const }}
          >
            <p
              className="mb-3 uppercase text-[#4a4a5a]"
              style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em' }}
            >
              {t('opt1Tag')}
            </p>
            <h3 className="font-medium text-[#1a1a1a]" style={{ fontSize: '1.5rem', lineHeight: 1.2 }}>
              {t('opt1Title')}
            </h3>
            <p className="mt-2 text-[0.875rem] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
              {t('opt1Desc')}
            </p>

            <div className="mt-8">
              <p className="text-[#1a1a1a]" style={{ fontSize: '2.25rem', fontWeight: 500, lineHeight: 1.1 }}>
                {t('opt1Price')}
              </p>
              <p className="mt-1 text-[0.8125rem] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
                {t('opt1PriceNote')}
              </p>
            </div>

            <div className="my-6 border-t border-[#e8e3dc]" />

            <p
              className="mb-3 uppercase text-[#4a4a5a]"
              style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em' }}
            >
              {t('strengthsLabel')}
            </p>
            <BulletList
              type="pro"
              items={[t('opt1Pro0'), t('opt1Pro1')]}
            />

            <p
              className="mt-6 mb-3 uppercase text-[#4a4a5a]"
              style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em' }}
            >
              {t('frictionLabel')}
            </p>
            <BulletList
              type="con"
              items={[t('opt1Con0'), t('opt1Con1'), t('opt1Con2')]}
            />
          </motion.article>

          {/* Card 2 — Hire an SDR */}
          <motion.article
            className="rounded-lg bg-white border border-[#e8e3dc] p-8"
            style={{ boxShadow: '0 1px 3px rgba(26,26,26,0.06), 0 1px 2px -1px rgba(26,26,26,0.06)' }}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const, delay: 0.08 }}
          >
            <p
              className="mb-3 uppercase text-[#4a4a5a]"
              style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em' }}
            >
              {t('opt2Tag')}
            </p>
            <h3 className="font-medium text-[#1a1a1a]" style={{ fontSize: '1.5rem', lineHeight: 1.2 }}>
              {t('opt2Title')}
            </h3>
            <p className="mt-2 text-[0.875rem] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
              {t('opt2Desc')}
            </p>

            <div className="mt-8">
              <p className="text-[#1a1a1a]" style={{ fontSize: '2.25rem', fontWeight: 500, lineHeight: 1.1 }}>
                {t('opt2Price')}
              </p>
              <p className="mt-1 text-[0.8125rem] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
                {t('opt2PriceNote')}
              </p>
            </div>

            <div className="my-6 border-t border-[#e8e3dc]" />

            <p
              className="mb-3 uppercase text-[#4a4a5a]"
              style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em' }}
            >
              {t('strengthsLabel')}
            </p>
            <BulletList
              type="pro"
              items={[t('opt2Pro0'), t('opt2Pro1')]}
            />

            <p
              className="mt-6 mb-3 uppercase text-[#4a4a5a]"
              style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em' }}
            >
              {t('frictionLabel')}
            </p>
            <BulletList
              type="con"
              items={[t('opt2Con0'), t('opt2Con1'), t('opt2Con2')]}
            />
          </motion.article>

          {/* Card 3 — Sentra (Featured) */}
          <motion.article
            className="rounded-lg p-8 lg:scale-[1.02]"
            style={{
              backgroundColor: '#eff6ff',
              border: '2px solid #2563eb',
              boxShadow: '0 10px 40px rgba(37,99,235,0.12)',
            }}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const, delay: 0.16 }}
          >
            <p
              className="mb-3 uppercase text-[#2563eb]"
              style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em' }}
            >
              {t('opt3Tag')}
            </p>
            <h3 className="font-medium text-[#1a1a1a]" style={{ fontSize: '1.5rem', lineHeight: 1.2 }}>
              {t('opt3Title')}
            </h3>
            <p className="mt-2 text-[0.875rem] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
              {t('opt3Desc')}
            </p>

            <div className="mt-8">
              <p className="text-[#1a1a1a]" style={{ fontSize: '2.25rem', fontWeight: 500, lineHeight: 1.1 }}>
                {t('opt3Price')}
              </p>
              <p className="mt-1 text-[0.8125rem] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
                {t('opt3PriceNote')}
              </p>
            </div>

            <div className="my-6 border-t border-[#2563eb]" style={{ opacity: 0.2 }} />

            <p
              className="mb-3 uppercase text-[#2563eb]"
              style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em' }}
            >
              {t('strengthsLabel')}
            </p>
            <BulletList
              featured
              type="pro"
              items={[t('opt3Pro0'), t('opt3Pro1'), t('opt3Pro2'), t('opt3Pro3')]}
            />

            <p
              className="mt-6 mb-3 uppercase text-[#4a4a5a]"
              style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em' }}
            >
              {t('tradeOffsLabel')}
            </p>
            <BulletList
              featured
              type="con"
              items={[t('opt3Con0'), t('opt3Con1')]}
            />

            <div className="mt-8">
              <CTAButton
                href="/signup"
                variant="primary"
                className="w-full justify-center py-3 text-sm font-medium"
              >
                {t('cta')}
              </CTAButton>
            </div>
          </motion.article>

        </div>
      </div>
    </section>
  );
}
