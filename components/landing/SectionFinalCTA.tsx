'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

export function SectionFinalCTA() {
  return (
    <section
      className="py-32 lg:py-40 px-6"
      style={{ backgroundColor: '#1a1a1a' }}
    >
      <div className="mx-auto max-w-3xl text-center">

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] as const }}
        >
          <h2
            className="font-medium text-white mx-auto"
            style={{
              fontSize: 'clamp(2.25rem, 5vw, 3.5rem)',
              lineHeight: 1.08,
              letterSpacing: '-0.02em',
              maxWidth: '30rem',
            }}
          >
            Your first meeting is one signup away.
          </h2>

          <p
            className="mt-6 mx-auto"
            style={{
              fontSize: '1.0625rem',
              fontWeight: 300,
              lineHeight: 1.55,
              color: '#a8a8a8',
              maxWidth: '30rem',
            }}
          >
            Set up in under an hour. No credit card, no annual commitment,
            no demo required.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-md px-7 py-3.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a1a] transition-opacity hover:opacity-90"
              style={{
                backgroundColor: '#ffffff',
                color: '#1a1a1a',
                fontWeight: 500,
                letterSpacing: '-0.01em',
              }}
            >
              Start free trial
            </Link>
            <Link
              href="/#faq"
              className="inline-flex items-center justify-center rounded-md px-7 py-3.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a1a] transition-opacity hover:opacity-75"
              style={{
                color: '#a8a8a8',
                fontWeight: 300,
                border: '1px solid rgba(255,255,255,0.12)',
              }}
            >
              Read the FAQ
            </Link>
          </div>

          <p
            className="mt-8"
            style={{ fontSize: '0.8125rem', fontWeight: 300, color: '#888888' }}
          >
            14-day trial. Cancel anytime.
          </p>
        </motion.div>

      </div>
    </section>
  );
}
