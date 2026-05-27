'use client';

import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <motion.svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-5 h-5 flex-shrink-0 text-[#4a4a5a]"
      animate={{ rotate: open ? 180 : 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <polyline points="6 9 12 15 18 9" />
    </motion.svg>
  );
}

export function SectionFAQ() {
  const t = useTranslations('landing.faq');
  const [openId, setOpenId] = useState<string | null>(null);
  const prefersReduced = useReducedMotion();

  const faqs = [
    { id: 'q1', question: t('q1Question'), answer: t('q1Answer') },
    { id: 'q2', question: t('q2Question'), answer: t('q2Answer') },
    { id: 'q3', question: t('q3Question'), answer: t('q3Answer') },
    { id: 'q4', question: t('q4Question'), answer: t('q4Answer') },
    { id: 'q5', question: t('q5Question'), answer: t('q5Answer') },
    { id: 'q6', question: t('q6Question'), answer: t('q6Answer') },
    { id: 'q7', question: t('q7Question'), answer: t('q7Answer') },
    { id: 'q8', question: t('q8Question'), answer: t('q8Answer') },
  ];

  function toggle(id: string) {
    setOpenId((prev) => (prev === id ? null : id));
  }

  return (
    <section id="faq" className="bg-[#faf8f5] py-24 lg:py-32">
      <div className="mx-auto max-w-2xl px-6 lg:px-8">

        {/* Section header */}
        <motion.div
          className="text-center mb-14"
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
            className="font-medium text-[#1a1a1a]"
            style={{
              fontSize: 'clamp(1.875rem, 4vw, 2.5rem)',
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
            }}
          >
            {t('headline')}
          </h2>
        </motion.div>

        {/* Accordion */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const }}
          className="divide-y divide-[#e8e3dc]"
          style={{ borderTop: '1px solid #e8e3dc', borderBottom: '1px solid #e8e3dc' }}
        >
          {faqs.map((faq) => {
            const isOpen = openId === faq.id;
            return (
              <div key={faq.id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${faq.id}`}
                  onClick={() => toggle(faq.id)}
                  className="w-full flex items-center justify-between gap-4 py-5 text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2"
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <span
                    className="text-[#1a1a1a]"
                    style={{ fontSize: '0.9375rem', fontWeight: 500, lineHeight: 1.4 }}
                  >
                    {faq.question}
                  </span>
                  <ChevronIcon open={isOpen} />
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`faq-answer-${faq.id}`}
                      role="region"
                      initial={prefersReduced ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={prefersReduced ? undefined : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      <p
                        className="pb-5 text-[#4a4a5a]"
                        style={{ fontSize: '0.9375rem', fontWeight: 300, lineHeight: 1.6 }}
                      >
                        {faq.answer}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </motion.div>

        {/* Closing nudge */}
        <motion.p
          className="mt-10 text-center"
          style={{ fontSize: '0.875rem', fontWeight: 300, color: '#9a9a9a', lineHeight: 1.5 }}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as const, delay: 0.15 }}
        >
          {t('closing')}{' '}
          <a
            href="mailto:hello@mirvo.ai"
            className="text-[#2563eb] underline underline-offset-2"
            style={{ fontWeight: 500 }}
          >
            {t('closingLink')}
          </a>
          {t('closingPost')}
        </motion.p>

      </div>
    </section>
  );
}
