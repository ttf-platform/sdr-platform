'use client';

import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

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

const faqs = [
  {
    id: 'q1',
    question: 'How is Sentra different from Instantly or Smartlead?',
    answer:
      'Instantly and Smartlead are sending infrastructure: they help you reach a list at scale. Sentra is the entire workflow: it finds the prospects, writes the emails, handles sending, and brings replies back to one inbox. You still need to connect a sending account, but Sentra replaces the five tools around it.',
  },
  {
    id: 'q2',
    question: 'Does Sentra send emails automatically, or do I approve each one?',
    answer:
      'You approve by default. Every email Sentra drafts lands in your queue first. Once you trust the cadence, you can enable autopilot for a specific campaign. You set the threshold; Sentra never flips that switch on its own.',
  },
  {
    id: 'q3',
    question: 'Will this hurt my domain reputation?',
    answer:
      'Sentra starts warmup the moment you connect your account, before your first campaign runs. Volume ramps gradually, bounce and spam rates are monitored continuously, and sending pauses automatically if anything looks off. Most users see improved deliverability within 2 weeks.',
  },
  {
    id: 'q4',
    question: 'Where does Sentra find prospects?',
    answer:
      'Sentra pulls from a verified B2B database (290M+ contacts), filtered by your ICP: job title, company size, industry, tech stack, and funding stage. You can also upload your own list in CSV. Contacts are deduplicated against your CRM if you connect one.',
  },
  {
    id: 'q5',
    question: 'How personalized are the emails actually?',
    answer:
      'Each email is generated per recipient using public signals: LinkedIn profile, company news, recent funding, job postings, and website copy. Not mail-merge tokens. The output reads like something a good SDR would write after 20 minutes of research, not like "Hi {{first_name}}".',
  },
  {
    id: 'q6',
    question: 'What CRMs does Sentra integrate with?',
    answer:
      'HubSpot and Salesforce are available on all paid plans. Pipedrive is on the roadmap for Q3 2026. If your CRM has a Zapier or Make connector, you can wire it up that way in the meantime.',
  },
  {
    id: 'q7',
    question: 'Can I cancel anytime?',
    answer:
      'Yes. No annual commitment, no cancellation fee. You can downgrade or cancel from your account settings at any time. Your data is exportable before and after cancellation.',
  },
  {
    id: 'q8',
    question: 'Is there a free trial?',
    answer:
      'Yes. 14 days, no credit card required. Full access to the Starter plan features. If you want to test Pro or Power features during the trial, contact support and we will enable them for you.',
  },
];

export function SectionFAQ() {
  const [openId, setOpenId] = useState<string | null>(null);
  const prefersReduced = useReducedMotion();

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
            FAQ
          </p>
          <h2
            className="font-medium text-[#1a1a1a]"
            style={{
              fontSize: 'clamp(1.875rem, 4vw, 2.5rem)',
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
            }}
          >
            Questions you probably have.
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
          Still have a question?{' '}
          <a
            href="mailto:hello@sentra.so"
            className="text-[#2563eb] underline underline-offset-2"
            style={{ fontWeight: 500 }}
          >
            Email us
          </a>
          . We reply same day.
        </motion.p>

      </div>
    </section>
  );
}
