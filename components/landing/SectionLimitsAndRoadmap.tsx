'use client';

import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { SectionEyebrow } from './SectionEyebrow';

export function SectionLimitsAndRoadmap() {
  const t = useTranslations('landing.limitsAndRoadmap');

  const limits = [
    { id: 'volume',    title: t('limit0Title'), body: t('limit0Body') },
    { id: 'team',      title: t('limit1Title'), body: t('limit1Body') },
    { id: 'channels',  title: t('limit2Title'), body: t('limit2Body') },
    { id: 'autonomous',title: t('limit3Title'), body: t('limit3Body') },
  ];

  const roadmap = [
    { id: 'linkedin',  quarter: t('roadmap0Quarter'), title: t('roadmap0Title'), body: t('roadmap0Body') },
    { id: 'insights',  quarter: t('roadmap1Quarter'), title: t('roadmap1Title'), body: t('roadmap1Body') },
    { id: 'proposals', quarter: t('roadmap2Quarter'), title: t('roadmap2Title'), body: t('roadmap2Body') },
  ];

  return (
    <section className="bg-[#f5f2ee] py-24 lg:py-32">
      <div className="mx-auto max-w-5xl px-6 lg:px-8">

        {/* Section header */}
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const }}
        >
          <SectionEyebrow>{t('eyebrow')}</SectionEyebrow>
          <h2
            className="font-medium text-[#1a1a1a] mx-auto"
            style={{
              fontSize: 'clamp(2rem, 4.5vw, 3rem)',
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
              maxWidth: '44rem',
            }}
          >
            {t('headline')}
          </h2>
        </motion.div>

        {/* Sub-bloc 1 — Limits */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const }}
        >
          <p
            className="mb-6 uppercase text-[#4a4a5a]"
            style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.16em' }}
          >
            {t('limitsHeader')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
            {limits.map((item) => (
              <div key={item.id}>
                <p
                  className="mb-2 text-[#1a1a1a]"
                  style={{ fontSize: '1rem', fontWeight: 500, lineHeight: 1.4 }}
                >
                  {item.title}
                </p>
                <p className="text-[0.875rem] leading-[1.5] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Separator */}
        <div className="my-16 border-t border-[#e8e3dc]" />

        {/* Sub-bloc 2 — Roadmap */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const }}
        >
          <p
            className="mb-6 uppercase text-[#3b6bef]"
            style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.16em' }}
          >
            {t('roadmapHeader')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {roadmap.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as const, delay: i * 0.08 }}
              >
                <p
                  className="mb-2 uppercase text-[#3b6bef]"
                  style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em' }}
                >
                  {item.quarter}
                </p>
                <h3
                  className="mb-2 font-medium text-[#1a1a1a]"
                  style={{ fontSize: '1.125rem', lineHeight: 1.3 }}
                >
                  {item.title}
                </h3>
                <p className="text-[0.875rem] leading-[1.5] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
                  {item.body}
                </p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Closing note */}
        <motion.p
          className="mt-12 text-center mx-auto"
          style={{
            fontWeight: 300,
            fontStyle: 'italic',
            fontSize: '0.8125rem',
            color: '#9a9a9a',
            maxWidth: '42rem',
            lineHeight: 1.5,
          }}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as const, delay: 0.15 }}
        >
          {t('disclaimer')}
        </motion.p>

      </div>
    </section>
  );
}
