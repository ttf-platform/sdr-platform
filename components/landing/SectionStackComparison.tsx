'use client';

import { motion } from 'framer-motion';
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
            The True Cost
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
            Three ways to ship outbound. One that makes sense before $1M ARR.
          </h2>
          <p
            className="text-[1.0625rem] leading-[1.5] text-[#4a4a5a] mx-auto"
            style={{ fontWeight: 300, maxWidth: '42rem' }}
          >
            Most founders don&apos;t realize they have three options. Until they&apos;ve sunk a quarter into the wrong one.
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
              Option 1
            </p>
            <h3 className="font-medium text-[#1a1a1a]" style={{ fontSize: '1.5rem', lineHeight: 1.2 }}>
              Assemble a stack
            </h3>
            <p className="mt-2 text-[0.875rem] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
              Build outbound from 5 specialized tools
            </p>

            <div className="mt-8">
              <p className="text-[#1a1a1a]" style={{ fontSize: '2.25rem', fontWeight: 500, lineHeight: 1.1 }}>
                $694/mo
              </p>
              <p className="mt-1 text-[0.8125rem] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
                + 8–12 hours setup + ongoing coordination
              </p>
            </div>

            <div className="my-6 border-t border-[#e8e3dc]" />

            <p
              className="mb-3 uppercase text-[#4a4a5a]"
              style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em' }}
            >
              Strengths
            </p>
            <BulletList
              type="pro"
              items={['Best-in-class tool per layer', 'Full control over each component']}
            />

            <p
              className="mt-6 mb-3 uppercase text-[#4a4a5a]"
              style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em' }}
            >
              Friction
            </p>
            <BulletList
              type="con"
              items={[
                '5 separate subscriptions to manage',
                'Each tool needs its own ICP, copy, sequences',
                'Things break across integrations',
              ]}
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
              Option 2
            </p>
            <h3 className="font-medium text-[#1a1a1a]" style={{ fontSize: '1.5rem', lineHeight: 1.2 }}>
              Hire a Sales Development Rep
            </h3>
            <p className="mt-2 text-[0.875rem] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
              Bring in a full-time outbound hire
            </p>

            <div className="mt-8">
              <p className="text-[#1a1a1a]" style={{ fontSize: '2.25rem', fontWeight: 500, lineHeight: 1.1 }}>
                $4,000–6,000/mo
              </p>
              <p className="mt-1 text-[0.8125rem] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
                + recruiting + benefits + 6-week ramp
              </p>
            </div>

            <div className="my-6 border-t border-[#e8e3dc]" />

            <p
              className="mb-3 uppercase text-[#4a4a5a]"
              style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em' }}
            >
              Strengths
            </p>
            <BulletList
              type="pro"
              items={['Human judgment on tricky replies', 'Builds your sales muscle long-term']}
            />

            <p
              className="mt-6 mb-3 uppercase text-[#4a4a5a]"
              style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em' }}
            >
              Friction
            </p>
            <BulletList
              type="con"
              items={[
                '$50k+ per year fully loaded',
                "Can't hire before product-market fit is clear",
                'Still needs the same 5 tools as Option 1',
              ]}
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
              Founder&apos;s Choice
            </p>
            <h3 className="font-medium text-[#1a1a1a]" style={{ fontSize: '1.5rem', lineHeight: 1.2 }}>
              Run Sentra
            </h3>
            <p className="mt-2 text-[0.875rem] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
              All-in-one outbound for founders
            </p>

            <div className="mt-8">
              <p className="text-[#1a1a1a]" style={{ fontSize: '2.25rem', fontWeight: 500, lineHeight: 1.1 }}>
                $149–399/mo
              </p>
              <p className="mt-1 text-[0.8125rem] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
                + no recruiting, no setup hell, no manual coordination
              </p>
            </div>

            <div className="my-6 border-t border-[#2563eb]" style={{ opacity: 0.2 }} />

            <p
              className="mb-3 uppercase text-[#2563eb]"
              style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em' }}
            >
              Strengths
            </p>
            <BulletList
              featured
              type="pro"
              items={[
                'One product replaces the stack',
                'Setup in under an hour',
                'You approve every email. AI you control.',
                'Cancel anytime, no annual commit',
              ]}
            />

            <p
              className="mt-6 mb-3 uppercase text-[#4a4a5a]"
              style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em' }}
            >
              Trade-offs
            </p>
            <BulletList
              featured
              type="con"
              items={[
                'Email-first (LinkedIn coming Q3 2026)',
                'Built for founders and early-stage teams, not enterprise sales orgs',
              ]}
            />

            <div className="mt-8">
              <CTAButton
                href="/signup"
                variant="primary"
                className="w-full justify-center py-3 text-sm font-medium"
              >
                Start free trial — no credit card
              </CTAButton>
            </div>
          </motion.article>

        </div>
      </div>
    </section>
  );
}
