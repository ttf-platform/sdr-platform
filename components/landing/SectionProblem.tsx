'use client';

import { motion } from 'framer-motion';

const tools = [
  { label: 'Data tool', price: '$149/mo' },
  { label: 'Enrichment', price: '$349/mo' },
  { label: 'Sending platform', price: '$97/mo' },
  { label: 'Multichannel seq.', price: '$79/mo' },
  { label: 'Booking link', price: '$20/mo' },
];

// Subtle rotations, not cartoonishly chaotic
const rotations = [-2, 1.5, -1, 2, -1.5];

const inView = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const } },
};

export function SectionProblem() {
  return (
    <section className="bg-[#f5f2ee] py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">

          {/* Visual — top on mobile, right on desktop */}
          <motion.div
            className="order-first lg:order-2"
            variants={inView}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-80px' }}
          >
            <div className="rounded-lg bg-white border border-[#e8e3dc] p-8 shadow-[0_1px_3px_rgba(26,26,26,0.06),0_1px_2px_-1px_rgba(26,26,26,0.06)]">

              {/* Chaos grid with SVG connectors */}
              <div className="relative">
                {/* Dashed connector lines — non-orthogonal to suggest integration chaos */}
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  aria-hidden="true"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  {/* cross connects: card1→card4, card2→card3 */}
                  <path
                    d="M24,20 C50,32 50,44 76,62"
                    stroke="#d4cec7"
                    strokeWidth="0.9"
                    strokeDasharray="3 2.5"
                    fill="none"
                  />
                  <path
                    d="M76,20 C50,32 50,44 24,62"
                    stroke="#d4cec7"
                    strokeWidth="0.9"
                    strokeDasharray="3 2.5"
                    fill="none"
                  />
                  {/* card3 → card5, card4 → card5 */}
                  <path
                    d="M24,62 C34,72 42,76 50,86"
                    stroke="#d4cec7"
                    strokeWidth="0.9"
                    strokeDasharray="3 2.5"
                    fill="none"
                  />
                  <path
                    d="M76,62 C66,72 58,76 50,86"
                    stroke="#d4cec7"
                    strokeWidth="0.9"
                    strokeDasharray="3 2.5"
                    fill="none"
                  />
                </svg>

                {/* Top 4 cards in 2-col grid */}
                <div className="grid grid-cols-2 gap-3 relative z-10">
                  {tools.slice(0, 4).map((tool, i) => (
                    <div
                      key={tool.label}
                      className="rounded-md bg-white border border-[#e8e3dc] px-4 py-3"
                      style={{ transform: `rotate(${rotations[i]}deg)` }}
                    >
                      <div
                        className="mb-1 uppercase text-[#4a4a5a]"
                        style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em' }}
                      >
                        {tool.label}
                      </div>
                      <div className="text-sm font-medium text-[#1a1a1a]">{tool.price}</div>
                    </div>
                  ))}
                </div>

                {/* 5th card centered below */}
                <div className="mt-3 flex justify-center relative z-10">
                  <div
                    className="rounded-md bg-white border border-[#e8e3dc] px-4 py-3"
                    style={{
                      width: 'calc(50% - 6px)',
                      transform: `rotate(${rotations[4]}deg)`,
                    }}
                  >
                    <div
                      className="mb-1 uppercase text-[#4a4a5a]"
                      style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em' }}
                    >
                      {tools[4].label}
                    </div>
                    <div className="text-sm font-medium text-[#1a1a1a]">{tools[4].price}</div>
                  </div>
                </div>
              </div>

              {/* Footer totals */}
              <div className="mt-6 pt-4 border-t border-[#e8e3dc] flex items-end justify-between">
                <div>
                  <div
                    className="uppercase text-[#9a9a9a]"
                    style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em' }}
                  >
                    Total
                  </div>
                  <div className="mt-1 text-2xl font-medium text-[#1a1a1a]">$694/mo</div>
                </div>
                <div className="text-right">
                  <div
                    className="uppercase text-[#9a9a9a]"
                    style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em' }}
                  >
                    Setup
                  </div>
                  <div className="mt-1 text-2xl font-medium text-[#1a1a1a]">8–12 hours</div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Copy — below visual on mobile, left on desktop */}
          <motion.div
            className="order-last lg:order-1"
            variants={inView}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const, delay: 0.08 }}
          >
            {/* Eyebrow */}
            <p
              className="mb-5 font-bold uppercase text-[#2563eb]"
              style={{ fontSize: '0.625rem', letterSpacing: '0.18em' }}
            >
              The Problem
            </p>

            {/* h2 — DM Sans 500, no Fraunces (Fraunces Budget Rule: spent on hero h1) */}
            <h2
              className="mb-6 font-medium text-[#1a1a1a]"
              style={{
                fontSize: 'clamp(2rem, 4.5vw, 3rem)',
                lineHeight: 1.1,
                letterSpacing: '-0.01em',
              }}
            >
              Outbound shouldn&apos;t take 5 tools to set up.
            </h2>

            {/* Body */}
            <div className="space-y-4" style={{ maxWidth: '65ch' }}>
              <p className="text-base leading-[1.5] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
                For most founders, cold outreach starts the same way. You buy a data tool. You add an
                enrichment layer. You set up a sending platform with deliverability tooling. You glue in
                a multichannel sequencer. You stitch a booking link at the end.
              </p>
              <p className="text-base leading-[1.5] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
                Five subscriptions. Eight hours of setup. A new ICP definition copied across each tool.
                And every Monday morning, something is broken or out of sync.
              </p>
            </div>

            {/* Pull-quote — Blueprint Wash background (no side-stripe border, follows design law) */}
            <blockquote className="mt-8 rounded-md bg-[#eff6ff] px-5 py-4">
              <p
                className="text-lg leading-[1.55] text-[#1a1a1a]"
                style={{ fontWeight: 300, fontStyle: 'italic' }}
              >
                It&apos;s the modern outbound stack — and it&apos;s why most founders give up on cold
                outreach.
              </p>
            </blockquote>
          </motion.div>

        </div>
      </div>
    </section>
  );
}
