'use client';

import { motion } from 'framer-motion';
import { CTAButton } from './CTAButton';

// ─── Principle icons ──────────────────────────────────────────────────────────

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#2563eb"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-8 h-8"
    >
      <path d="M2 12s3.636-7 10-7 10 7 10 7-3.636 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#2563eb"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-8 h-8"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

function DollarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#2563eb"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-8 h-8"
    >
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#2563eb"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-8 h-8"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// ─── Principle data ───────────────────────────────────────────────────────────

const principles = [
  {
    id: 'no-gate',
    Icon: EyeIcon,
    title: 'No demo gate.',
    body: "You shouldn't have to schedule a 45-minute call with a sales engineer to learn what an outbound product costs. Pricing is on this page. Setup is self-serve.",
  },
  {
    id: 'approve',
    Icon: CheckCircleIcon,
    title: 'AI drafts. You approve.',
    body: "Every email Sentra writes lands in your queue first. You approve in one click, or set autopilot once you trust the cadence. Sentra never sends in your name without your say-so.",
  },
  {
    id: 'pricing',
    Icon: DollarIcon,
    title: 'Flat pricing. Founder-friendly.',
    body: "No per-user multipliers. No 5-seat minimum annual contract. No enterprise tier you'll get pushed into. Three plans. One can fit you. Cancel anytime.",
  },
  {
    id: 'founders',
    Icon: UsersIcon,
    title: 'Built by founders. Used by founders.',
    body: "Sentra is built by people who ran outbound themselves before AI made it possible to systematize. We use it on Sentra. If something feels broken, we hear about it the same day you do.",
  },
];

// ─── Section ──────────────────────────────────────────────────────────────────

export function SectionBuiltForFounders() {
  return (
    <section className="bg-[#faf8f5] py-24 lg:py-32">
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
            Built for Founders
          </p>
          <h2
            className="mb-6 font-medium text-[#1a1a1a] mx-auto"
            style={{
              fontSize: 'clamp(2rem, 4.5vw, 3rem)',
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
              maxWidth: '44rem',
            }}
          >
            AI you control. Not AI that runs wild.
          </h2>
          <p
            className="text-[1.0625rem] leading-[1.6] text-[#4a4a5a] mx-auto"
            style={{ fontWeight: 300, maxWidth: '42rem' }}
          >
            We built Sentra after watching too many AI SDR tools promise autopilot and deliver
            auto-spam. Founders deserve outbound infrastructure they can trust, and that means
            staying in the loop on what gets sent in their name.
          </p>
        </motion.div>

        {/* 2×2 principles grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
          {principles.map(({ id, Icon, title, body }, i) => (
            <motion.div
              key={id}
              className="flex items-start gap-5"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const, delay: i * 0.08 }}
            >
              {/* Icon slot — 40px wide, icon is 32px */}
              <div className="flex-shrink-0 w-10 flex justify-start pt-0.5">
                <Icon />
              </div>
              {/* Content */}
              <div>
                <h3
                  className="mb-2 font-medium text-[#1a1a1a]"
                  style={{ fontSize: '1.125rem', lineHeight: 1.3 }}
                >
                  {title}
                </h3>
                <p
                  className="text-[0.9375rem] leading-[1.6] text-[#4a4a5a]"
                  style={{ fontWeight: 300 }}
                >
                  {body}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Closing */}
        <motion.div
          className="mt-16 text-center mx-auto max-w-2xl"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const, delay: 0.1 }}
        >
          <p className="text-[1.125rem] text-[#1a1a1a]" style={{ fontWeight: 300 }}>
            If that sounds like the outbound product you&apos;d build for yourself, you&apos;ll
            feel at home here.
          </p>
          <div className="mt-8 flex justify-center">
            <CTAButton href="/signup" variant="primary" className="px-8 py-3 text-sm font-medium">
              Start free trial — no credit card
            </CTAButton>
          </div>
        </motion.div>

      </div>
    </section>
  );
}
