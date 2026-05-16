'use client';

import { motion } from 'framer-motion';

const limits = [
  {
    id: 'volume',
    title: 'You want to send 10,000+ emails per day.',
    body: "Sentra is built for quality, not volume. If your strategy is high-volume spray-and-pray, you'll outgrow our caps fast. Try Smartlead or Instantly Hypergrowth.",
  },
  {
    id: 'team',
    title: 'You manage a 20+ person SDR team.',
    body: "Sentra is for solo founders and early-stage teams. If you have a full SDR org, you need Salesloft or Outreach: different category, different price.",
  },
  {
    id: 'channels',
    title: 'You need LinkedIn, WhatsApp, and voice today.',
    body: "Sentra is email-first for V1. LinkedIn integration is on the roadmap for Q3 2026. WhatsApp and voice are not planned: they're separate problems.",
  },
  {
    id: 'autonomous',
    title: 'You want a fully autonomous AI.',
    body: "Sentra drafts, but you approve. We don't ship sends-without-approval-by-default because that's how reputations get burned. AI you control is a feature, not a limitation.",
  },
];

const roadmap = [
  {
    id: 'linkedin',
    quarter: 'Q3 2026',
    title: 'LinkedIn outreach',
    body: 'Multi-account LinkedIn integrated into your campaigns. Sequencing across email and LinkedIn.',
  },
  {
    id: 'insights',
    quarter: 'Q4 2026',
    title: 'Meeting Insights',
    body: 'Pull call recordings from Fathom or Fireflies. Sentra summarizes outcomes and updates the deal status automatically.',
  },
  {
    id: 'proposals',
    quarter: '2027',
    title: 'AI Proposal Drafts',
    body: 'After the meeting, Sentra drafts the follow-up proposal based on what was discussed. You approve, you send. From cold to closed.',
  },
];

export function SectionLimitsAndRoadmap() {
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
          <p
            className="mb-5 font-bold uppercase text-[#2563eb]"
            style={{ fontSize: '0.625rem', letterSpacing: '0.18em' }}
          >
            Transparency
          </p>
          <h2
            className="font-medium text-[#1a1a1a] mx-auto"
            style={{
              fontSize: 'clamp(2rem, 4.5vw, 3rem)',
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
              maxWidth: '44rem',
            }}
          >
            What we don&apos;t do. And what&apos;s coming next.
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
            Not for you if
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
            className="mb-6 uppercase text-[#2563eb]"
            style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.16em' }}
          >
            What&apos;s coming next
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
                  className="mb-2 uppercase text-[#2563eb]"
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
          Roadmap is directional, not contractual: we ship when it&apos;s right, not when the calendar says so.
        </motion.p>

      </div>
    </section>
  );
}
