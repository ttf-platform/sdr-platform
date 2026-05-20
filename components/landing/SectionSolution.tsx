'use client';

import { useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { CTAButton } from './CTAButton';

// X positions (0–100) in SVG viewBox for the 5 converging lines
const chipXPositions = [5, 23, 50, 77, 95];

const inView = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const } },
};

export function SectionSolution() {
  const t = useTranslations('landing.solution');
  const reduced = useReducedMotion() ?? false;
  const cardRef = useRef<HTMLDivElement>(null);
  const cardInView = useInView(cardRef, { once: true, margin: '-60px' });

  const chips = [
    { label: t('chip0Label'), price: t('chip0Price') },
    { label: t('chip1Label'), price: t('chip1Price') },
    { label: t('chip2Label'), price: t('chip2Price') },
    { label: t('chip3Label'), price: t('chip3Price') },
    { label: t('chip4Label'), price: t('chip4Price') },
  ];

  const capabilities = [
    t('chip0Label'),
    t('chip1Label'),
    t('chip2Label'),
    t('chip3Label'),
    t('chip4Label'),
  ];

  return (
    <section className="bg-[#faf8f5] py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">

        {/* Section header — centered, unchanged */}
        <motion.div
          className="text-center"
          variants={inView}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
        >
          <p
            className="mb-5 font-bold uppercase text-[#2563eb]"
            style={{ fontSize: '0.625rem', letterSpacing: '0.18em' }}
          >
            {t('eyebrow')}
          </p>

          <h2
            className="mb-6 font-medium text-[#1a1a1a] mx-auto"
            style={{
              fontSize: 'clamp(2rem, 4.5vw, 3rem)',
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
              maxWidth: '36rem',
            }}
          >
            {t('headline')}
          </h2>

          <div className="mx-auto" style={{ maxWidth: '42rem' }}>
            <p className="text-base leading-[1.6] text-[#4a4a5a] lg:text-lg" style={{ fontWeight: 300 }}>
              {t('body1')}
            </p>
            <p className="mt-4 text-base leading-[1.6] text-[#4a4a5a] lg:text-lg" style={{ fontWeight: 300 }}>
              {t('body2')}
            </p>
          </div>
        </motion.div>

        {/* Visual convergence flow */}
        <div className="mt-16 mx-auto max-w-2xl">

          {/* Narrative lead-in */}
          <motion.p
            className="text-center text-base text-[#4a4a5a] mb-6"
            style={{ fontWeight: 300, fontStyle: 'italic' }}
            variants={inView}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const, delay: 0.05 }}
          >
            {t('narrativeIn')}
          </motion.p>

          {/* 5 chips — visible, sized up, with prices */}
          <motion.div
            className="flex flex-wrap justify-center gap-3"
            variants={inView}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const, delay: 0.1 }}
          >
            {chips.map((chip) => (
              <div
                key={chip.label}
                className="rounded-md bg-white border border-[#e8e3dc] px-5 py-3 flex flex-col items-center"
                style={{ boxShadow: '0 1px 3px rgba(26,26,26,0.06)' }}
              >
                <span className="text-[13px] font-medium text-[#1a1a1a]">{chip.label}</span>
                <span className="mt-0.5 text-[10px] text-[#9a9a9a]" style={{ fontWeight: 300 }}>
                  {chip.price}
                </span>
              </div>
            ))}
          </motion.div>

          {/* Convergence zone: 5 lines drawing into a chevron */}
          <div className="relative my-4" aria-hidden="true">
            <svg
              viewBox="0 0 100 32"
              className="w-full"
              style={{ height: 80 }}
              preserveAspectRatio="none"
            >
              {/* 5 converging lines — draw simultaneously in 600ms */}
              {chipXPositions.map((x, i) => (
                <motion.path
                  key={i}
                  d={`M ${x} 0 C ${x} 16 50 16 50 22`}
                  stroke="#e8e3dc"
                  strokeWidth="0.9"
                  fill="none"
                  initial={{ pathLength: reduced ? 1 : 0 }}
                  whileInView={{ pathLength: 1 }}
                  viewport={{ once: true, margin: '-60px' }}
                  transition={reduced ? { duration: 0 } : { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const }}
                />
              ))}

              {/* Chevron at convergence point — appears after lines complete */}
              <motion.path
                d="M 44 24 L 50 31 L 56 24"
                stroke="#2563eb"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                initial={{ pathLength: reduced ? 1 : 0, opacity: reduced ? 1 : 0 }}
                whileInView={{ pathLength: 1, opacity: 1 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const, delay: 0.65 }
                }
              />
            </svg>
          </div>

          {/* Sentra card — scale-up on enter + border pulse 1x */}
          <motion.div
            ref={cardRef}
            className="rounded-lg bg-white px-8 py-8"
            style={{
              borderStyle: 'solid',
              borderWidth: '2px',
              boxShadow: '0 10px 40px rgba(37,99,235,0.12)',
            }}
            animate={
              reduced
                ? { scale: 1, borderColor: '#2563eb' }
                : cardInView
                ? {
                    scale: 1,
                    borderColor: ['#2563eb', '#60a5fa', '#2563eb'],
                  }
                : { scale: 0.98, borderColor: '#2563eb' }
            }
            transition={{
              scale: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const },
              borderColor: { duration: 0.8, delay: 0.5, times: [0, 0.5, 1], ease: 'easeOut' },
            }}
          >
            {/* Logo + name */}
            <div className="flex items-center gap-3 mb-6">
              <div
                className="flex-shrink-0 flex items-center justify-center rounded-md bg-[#2563eb]"
                style={{ width: 28, height: 28 }}
                aria-hidden="true"
              >
                <span className="text-white text-sm font-bold">S</span>
              </div>
              <div>
                <div className="text-2xl font-medium text-[#1a1a1a]">Sentra</div>
                <div className="text-sm text-[#4a4a5a]" style={{ fontWeight: 300 }}>
                  {t('cardTagline')}
                </div>
              </div>
            </div>

            {/* Capability tags */}
            <div className="border-t border-[#e8e3dc] pt-4">
              <span
                className="uppercase text-[#2563eb]"
                style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em' }}
              >
                {capabilities.join('  ·  ')}
              </span>
            </div>
          </motion.div>

          {/* Narrative close */}
          <motion.p
            className="text-center text-base text-[#4a4a5a] mt-6"
            style={{ fontWeight: 300, fontStyle: 'italic' }}
            variants={inView}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const, delay: 0.1 }}
          >
            {t('narrativeOut')}
          </motion.p>
        </div>

        {/* CTA */}
        <motion.div
          className="mt-12 flex justify-center"
          variants={inView}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const, delay: 0.15 }}
        >
          <CTAButton href="/signup" variant="primary" className="px-6 py-3 text-sm font-medium">
            {t('cta')}
          </CTAButton>
        </motion.div>

      </div>
    </section>
  );
}
