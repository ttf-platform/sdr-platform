'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { SectionEyebrow } from './SectionEyebrow';

const ease = [0.16, 1, 0.3, 1] as const;

function SignalsVisual({
  signalLabel, signalExample, scan, matches, company, meta, drafted, approve,
}: {
  signalLabel: string; signalExample: string; scan: string; matches: string;
  company: string; meta: string; drafted: string; approve: string;
}) {
  const reduced = useReducedMotion() ?? false;

  return (
    <motion.div
      className="mx-auto max-w-md rounded-lg bg-white border border-[#e8e3dc] p-5"
      style={{ boxShadow: '0 10px 40px rgba(37,99,235,0.10)' }}
      initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={reduced ? { duration: 0 } : { duration: 0.5, ease }}
      aria-hidden="true"
    >
      <div className="uppercase text-[#3b6bef] mb-2" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em' }}>
        {signalLabel}
      </div>
      <div className="rounded-md bg-[#f5f2ee] border border-[#e8e3dc] px-3 py-2 text-[13px] text-[#1a1a1a]" style={{ fontWeight: 500 }}>
        {signalExample}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b6bef" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
        <span className="text-[11px] text-[#4a4a5a]" style={{ fontWeight: 300 }}>{scan}</span>
        <span className="text-[11px] font-bold text-[#1a1a1a]">· {matches}</span>
      </div>

      <div className="mt-3 rounded-md bg-[#f5f2ee] border border-[#e8e3dc] px-3 py-2.5 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-[#1a1a1a] truncate">{company}</div>
          <div className="text-[11px] text-[#6b6b7b]">{meta}</div>
        </div>
        <span className="flex-shrink-0 ml-2 text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[#3b6bef]">
          {drafted}
        </span>
      </div>

      <div className="mt-3" role="presentation">
        <div className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5" style={{ border: '1px solid #3b6bef', color: '#3b6bef', backgroundColor: 'transparent' }}>
          <svg width="9" height="8" viewBox="0 0 8 7" fill="none" aria-hidden="true">
            <path d="M1 3.5L3 5.5L7 1" stroke="#3b6bef" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[11px] font-medium">{approve}</span>
        </div>
      </div>
    </motion.div>
  );
}

export function SectionSignals() {
  const t = useTranslations('landing.signals');
  const reduced = useReducedMotion() ?? false;

  const beats = [
    { index: '01', title: t('beat0Title'), body: t('beat0Body') },
    { index: '02', title: t('beat1Title'), body: t('beat1Body') },
    { index: '03', title: t('beat2Title'), body: t('beat2Body') },
  ];

  return (
    <section id="signals" aria-labelledby="signals-heading" className="bg-[#faf8f5] py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">

        <motion.div
          className="text-center mb-16"
          initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={reduced ? { duration: 0 } : { duration: 0.45, ease }}
        >
          <SectionEyebrow>{t('eyebrow')}</SectionEyebrow>
          <h2 id="signals-heading" className="mb-4 font-medium text-[#1a1a1a] mx-auto" style={{ fontSize: 'clamp(1.875rem, 4vw, 2.5rem)', lineHeight: 1.1, letterSpacing: '-0.01em', maxWidth: '36rem' }}>
            {t('headline')}
          </h2>
          <p className="text-base leading-[1.5] text-[#4a4a5a] mx-auto" style={{ fontWeight: 300, maxWidth: '42rem' }}>
            {t('body')}
          </p>
        </motion.div>

        <SignalsVisual
          signalLabel={t('visualSignalLabel')}
          signalExample={t('visualSignalExample')}
          scan={t('visualScan')}
          matches={t('visualMatches')}
          company={t('visualMatchCompany')}
          meta={t('visualMatchMeta')}
          drafted={t('visualDrafted')}
          approve={t('visualApprove')}
        />

        <div className="mt-16 grid grid-cols-1 gap-10 lg:grid-cols-3 lg:gap-8">
          {beats.map((beat, i) => (
            <motion.div
              key={beat.index}
              initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={reduced ? { duration: 0 } : { duration: 0.45, ease, delay: i * 0.1 }}
            >
              <div className="mb-3 font-medium uppercase text-[#3b6bef]" style={{ fontSize: '13px', letterSpacing: '0.06em' }}>
                {beat.index}
              </div>
              <h3 className="mb-2 font-medium text-[#1a1a1a]" style={{ fontSize: '1.125rem', lineHeight: 1.3 }}>
                {beat.title}
              </h3>
              <p className="text-base leading-[1.5] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
                {beat.body}
              </p>
            </motion.div>
          ))}
        </div>

        <motion.p
          className="mt-16 text-center mx-auto text-base text-[#4a4a5a]"
          style={{ fontWeight: 300, fontStyle: 'italic', maxWidth: '42rem', lineHeight: 1.6 }}
          initial={{ opacity: reduced ? 1 : 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={reduced ? { duration: 0 } : { duration: 0.45, ease, delay: 0.1 }}
        >
          {t('close')}
        </motion.p>

      </div>
    </section>
  );
}
