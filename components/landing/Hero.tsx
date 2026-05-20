'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { CTAButton } from './CTAButton';

type Phase = 1 | 2 | 3 | 4 | 5;

const PHASE_LABELS: Record<Phase, string> = {
  1: '01  SOURCING',
  2: '02  DRAFTING',
  3: '03  AWAITING REVIEW',
  4: '04  REPLIED',
  5: '05  MEETING BOOKED',
};

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.13 } } };
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] as const } },
};

function GrainOverlay() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <filter id="grain-hero">
        <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain-hero)" opacity="0.025" />
    </svg>
  );
}

// ─── Phase strip ──────────────────────────────────────────────────────────────

function PhaseStrip({ phase, loopKey, reduced }: { phase: Phase; loopKey: number; reduced: boolean }) {
  return (
    <div
      className="inline-flex items-center gap-3 rounded-md bg-white mb-3 self-start"
      style={{
        padding: '6px 12px',
        border: '1px solid #e8e3dc',
        boxShadow: '0 1px 3px rgba(26,26,26,0.06), 0 1px 2px -1px rgba(26,26,26,0.06)',
      }}
    >
      <div className="flex gap-2 flex-shrink-0">
        {([1, 2, 3, 4, 5] as Phase[]).map((p) => (
          <motion.div
            key={p}
            className="rounded-full"
            style={{ height: '6px', width: '6px' }}
            animate={{
              backgroundColor: p === phase ? '#1a1a1a' : p < phase ? '#4a4a5a' : '#e8e3dc',
              scale: p === phase ? 1.25 : 1,
            }}
            transition={{ duration: reduced ? 0 : 0.2 }}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.span
          key={`${loopKey}-label-${phase}`}
          initial={reduced ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduced ? {} : { opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.18 }}
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase' as const,
            color: '#1a1a1a',
            fontFamily: 'DM Sans, -apple-system, sans-serif',
          }}
        >
          {PHASE_LABELS[phase]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

// ─── Dashboard card ───────────────────────────────────────────────────────────

function DashboardCard({ phase, loopKey, reduced }: { phase: Phase; loopKey: number; reduced: boolean }) {
  const borderColor = phase === 4 ? '#bfdbfe' : '#e8e3dc';

  const badge: Record<Phase, { cls: string; label: string }> = {
    1: { cls: 'bg-green-50 border border-green-200 text-green-700', label: 'Active' },
    2: { cls: 'bg-green-50 border border-green-200 text-green-700', label: 'Active' },
    3: { cls: 'bg-amber-50 border border-[#fde68a] text-[#d97706]', label: '● AWAITING REVIEW' },
    4: { cls: 'bg-blue-50 border border-blue-200 text-[#2563eb]', label: 'Reply' },
    5: { cls: 'bg-[#eff6ff] border border-blue-200 text-[#2563eb]', label: 'Confirmed' },
  };

  return (
    <motion.div
      className="h-full rounded-xl bg-white overflow-hidden flex flex-col"
      style={{
        borderWidth: '1px',
        borderStyle: 'solid',
        boxShadow: '0 1px 3px rgba(26,26,26,0.06), 0 1px 2px -1px rgba(26,26,26,0.06)',
      }}
      animate={{ borderColor }}
      transition={reduced ? { duration: 0 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#e8e3dc] bg-[#faf8f5] flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-[#1a1a1a]">Sentra activity</div>
          <div className="text-[10px] text-[#9a9a9a] mt-0.5">Running now</div>
        </div>
        <AnimatePresence mode="wait">
          <motion.span
            key={`${loopKey}-status-${phase}`}
            initial={reduced ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduced ? {} : { opacity: 0, scale: 0.85 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
            className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${badge[phase].cls}`}
          >
            {badge[phase].label}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Phase content */}
      <div className="flex-1 p-3 overflow-hidden flex flex-col justify-center">
        <AnimatePresence mode="wait">

          {phase === 1 && (
            <motion.div
              key={`${loopKey}-p1`}
              initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? {} : { opacity: 0, y: -5 }}
              transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] as const }}
              className="space-y-3"
            >
              <div>
                <div className="text-[10px] font-semibold text-[#1a1a1a] mb-1">Sourcing prospects</div>
                <p className="text-[10px] text-[#4a4a5a]">SaaS · 50–200 employees · Series A</p>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] text-[#9a9a9a]">Prospects found</span>
                  <span className="text-[9px] font-bold text-[#1a1a1a]">47</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#e8e3dc] overflow-hidden">
                  <motion.div
                    key={`${loopKey}-bar`}
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={reduced ? { duration: 0 } : { duration: 3.2, ease: 'linear' }}
                    className="h-full rounded-full bg-[#2563eb]"
                  />
                </div>
              </div>
            </motion.div>
          )}

          {phase === 2 && (
            <motion.div
              key={`${loopKey}-p2`}
              initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? {} : { opacity: 0, y: -5 }}
              transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] as const }}
              className="space-y-3"
            >
              <div>
                <div className="text-[10px] font-semibold text-[#1a1a1a] mb-1">Drafting email</div>
                <p className="text-[10px] text-[#4a4a5a]">Sarah Chen · Acme Inc · VP Sales</p>
              </div>
              <div className="rounded-lg bg-[#faf8f5] border border-[#e8e3dc] px-3 py-2 space-y-1.5">
                <div className="text-[9px] text-[#9a9a9a]">Subject: Quick question about sales stack</div>
                <div className="flex items-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="h-1 w-1 rounded-full bg-[#4a4a5a] flex-shrink-0"
                      animate={reduced ? {} : { opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                    />
                  ))}
                  <span className="text-[9px] text-[#9a9a9a] ml-1">Writing...</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Phase 3 — HITL allégé: amber concentré sur badge + TO:, pas sur container */}
          {phase === 3 && (
            <motion.div
              key={`${loopKey}-p3`}
              initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? {} : { opacity: 0, y: -5 }}
              transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] as const }}
              className="space-y-2"
            >
              <div>
                <div className="text-[10px] font-semibold text-[#1a1a1a] mb-0.5">Email ready for review</div>
                <p className="text-[10px] text-[#4a4a5a]">Sarah Chen · Acme Inc</p>
              </div>
              {/* Email container neutre — amber uniquement sur le label TO: */}
              <div className="rounded-lg bg-white border border-[#e8e3dc] px-3 py-2 space-y-1">
                <div className="text-[9px] font-medium" style={{ color: '#d97706' }}>
                  TO: sarah@acmeinc.com
                </div>
                <p className="text-[9px] text-[#1a1a1a] leading-[1.4]">
                  Hi Sarah, I noticed Acme is expanding the sales team...
                </p>
              </div>
              {/* Ghost amber button — pas de solid bleu imposant */}
              <div role="presentation" aria-hidden="true">
                <div
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5"
                  style={{ border: '1px solid #d97706', color: '#d97706', backgroundColor: 'transparent' }}
                >
                  <svg width="8" height="7" viewBox="0 0 8 7" fill="none" aria-hidden="true">
                    <path d="M1 3.5L3 5.5L7 1" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-[10px] font-medium">Approve</span>
                </div>
              </div>
            </motion.div>
          )}

          {phase === 4 && (
            <motion.div
              key={`${loopKey}-p4`}
              initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? {} : { opacity: 0, y: -5 }}
              transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] as const }}
            >
              <div className="flex items-start gap-2.5 rounded-lg bg-[#eff6ff] border border-blue-100 px-3 py-2.5">
                <div className="mt-0.5 flex-shrink-0 h-5 w-5 rounded-md bg-blue-100 flex items-center justify-center">
                  <svg width="10" height="9" viewBox="0 0 10 9" fill="none" aria-hidden="true">
                    <path d="M4 1L1 4L4 7" stroke="#2563eb" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M1 4H7C8.1 4 9 4.9 9 6V8" stroke="#2563eb" strokeWidth="0.9" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-[10px] font-semibold text-[#1a1a1a]">Reply received</span>
                    <span className="flex-shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[#2563eb]">
                      Reply
                    </span>
                  </div>
                  <p className="text-[10px] text-[#4a4a5a]">
                    <span className="font-semibold text-[#1a1a1a]">Sarah Chen</span>
                    {' '}· Acme ·{' '}
                    <span>&ldquo;Interested in a 15-min call&rdquo;</span>
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Phase 5 — payoff: confirmation booking dashboard */}
          {phase === 5 && (
            <motion.div
              key={`${loopKey}-p5`}
              initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? {} : { opacity: 0, y: -5 }}
              transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] as const }}
              className="space-y-2"
            >
              <div>
                <div className="text-[10px] font-semibold text-[#1a1a1a] mb-0.5">Meeting scheduled</div>
                <p className="text-[10px] text-[#4a4a5a]">Sarah Chen · Acme Inc</p>
              </div>
              <div className="rounded-lg bg-[#2563eb] px-3 py-2 flex items-center gap-2">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                  className="flex-shrink-0"
                >
                  <path
                    d="M1.5 6L4.5 9.5L10.5 2"
                    stroke="white"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold text-white">Fri 10:00 · 30 min</div>
                  <div className="text-[9px]" style={{ color: 'rgba(219,234,254,0.8)' }}>
                    Added to your calendar
                  </div>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* Footer stats */}
      <div className="px-4 py-2.5 border-t border-[#e8e3dc] bg-[#faf8f5]">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'Sourced', value: phase >= 1 ? '47' : '—', pulse: false },
            { label: 'Replies', value: phase >= 4 ? '1' : '—', pulse: false },
            { label: 'Booked', value: phase >= 5 ? '1' : '—', pulse: phase === 5 },
          ].map((s) => (
            <div key={s.label}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${s.label}-${s.value}`}
                  initial={s.pulse && !reduced ? { opacity: 0, y: 5 } : { opacity: 1, y: 0 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: s.pulse && !reduced ? 0.3 : 0 }}
                  className="text-sm font-bold text-[#1a1a1a] tabular-nums"
                >
                  {s.value}
                </motion.div>
              </AnimatePresence>
              <div className="text-[9px] text-[#9a9a9a]">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Calendar panel ───────────────────────────────────────────────────────────

function CalendarPanel({ phase, loopKey, reduced }: { phase: Phase; loopKey: number; reduced: boolean }) {
  const showSarah = phase === 5 || reduced;
  const [showBookedBadge, setShowBookedBadge] = useState(false);

  useEffect(() => {
    setShowBookedBadge(false);
    if (phase === 5 && !reduced) {
      const t1 = setTimeout(() => setShowBookedBadge(true), 300);
      const t2 = setTimeout(() => setShowBookedBadge(false), 1800);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [phase, reduced]);

  return (
    <div className="h-full rounded-xl border border-[#e8e3dc] bg-white overflow-hidden flex flex-col"
      style={{ boxShadow: '0 1px 3px rgba(26,26,26,0.06), 0 1px 2px -1px rgba(26,26,26,0.06)' }}
    >
      <div className="px-3 py-3 border-b border-[#e8e3dc] bg-[#faf8f5]">
        <div className="text-xs font-semibold text-[#1a1a1a]">This week</div>
        <div className="text-[10px] text-[#9a9a9a] mt-0.5">May 5–9, 2026</div>
      </div>

      <div className="flex-1 p-2.5 space-y-1.5 overflow-hidden">
        {[
          { name: 'Marcus Webb', co: 'Blue Frontier', time: '11:30' },
          { name: 'Jordan Kim', co: 'NovaBridge', time: '14:00' },
        ].map((m) => (
          <div
            key={m.name}
            className="flex items-start gap-2 rounded-lg bg-[#faf8f5] border border-[#e8e3dc] px-2.5 py-2"
          >
            <div className="mt-1 flex-shrink-0 h-1.5 w-1.5 rounded-full bg-[#9a9a9a]" />
            <div className="min-w-0">
              <div className="text-[10px] font-semibold text-[#1a1a1a] truncate">{m.name}</div>
              <div className="text-[9px] text-[#9a9a9a]">{m.co} · {m.time}</div>
            </div>
          </div>
        ))}

        {/* Sarah Chen — payoff Phase 5: Blueprint Blue plein, ✓ blanc, scale-up + pulse 1x */}
        <AnimatePresence>
          {showSarah && (
            <motion.div
              key={`${loopKey}-sarah`}
              initial={reduced ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
              animate={
                reduced
                  ? {}
                  : { opacity: 1, scale: [0.9, 1.0, 1.04, 1.0] }
              }
              exit={reduced ? {} : { opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
              transition={
                reduced
                  ? { duration: 0 }
                  : {
                      opacity: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const },
                      scale: {
                        duration: 1.1,
                        times: [0, 0.45, 0.73, 1.0],
                        ease: [0.16, 1, 0.3, 1] as const,
                      },
                    }
              }
              className="flex items-center gap-2 rounded-lg bg-[#2563eb] px-2.5 py-2"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden="true"
                className="flex-shrink-0"
              >
                <path
                  d="M2 7L5.5 10.5L12 3"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <div className="text-[10px] font-semibold text-white truncate">Sarah Chen</div>
                  <span className="flex-shrink-0 text-[8px] font-bold" style={{ color: 'rgba(219,234,254,0.8)' }}>
                    New
                  </span>
                </div>
                <div className="text-[9px]" style={{ color: 'rgba(219,234,254,0.75)' }}>
                  Acme · Fri 10:00 · 30 min
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* "Booked just now" — badge éphémère, disparaît après 1.5s */}
        <AnimatePresence>
          {showBookedBadge && (
            <motion.p
              key="booked-badge"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="pl-1 text-[10px] font-semibold text-[#2563eb]"
            >
              Booked just now
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="px-3 py-2.5 border-t border-[#e8e3dc] bg-[#faf8f5]">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-[#9a9a9a]">Meetings this week</span>
          <span className="text-xs font-bold text-[#1a1a1a]">{showSarah ? '3' : '2'}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Hero export ──────────────────────────────────────────────────────────────

export function Hero() {
  const t = useTranslations('landing.hero');
  const reduced = useReducedMotion() ?? false;
  const [phase, setPhase] = useState<Phase>(reduced ? 5 : 1);
  const [loopKey, setLoopKey] = useState(0);

  useEffect(() => {
    if (reduced) {
      setPhase(5);
      return;
    }
    setPhase(1);
    // 21s loop: 4s par phase + 1s buffer final
    const t1 = setTimeout(() => setPhase(2), 4000);
    const t2 = setTimeout(() => setPhase(3), 8000);
    const t3 = setTimeout(() => setPhase(4), 12000);
    const t4 = setTimeout(() => setPhase(5), 16000);
    const t5 = setTimeout(() => setLoopKey((k) => k + 1), 21000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [reduced, loopKey]);

  const stats = [
    { value: t('stat0Value'), label: t('stat0Label') },
    { value: t('stat1Value'), label: t('stat1Label') },
    { value: t('stat2Value'), label: t('stat2Label') },
  ];

  return (
    <section className="relative min-h-[calc(100vh-4rem)] pt-24 pb-16 overflow-hidden bg-[#faf8f5]">
      <GrainOverlay />

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[5fr_6fr] lg:gap-16">

          {/* ── Left: copy ── */}
          <motion.div
            variants={stagger}
            initial={false}
            animate="show"
            className="flex flex-col"
          >
            <motion.div variants={fadeUp} className="mb-5">
              <p
                className="font-bold text-[#2563eb]"
                style={{ fontSize: '0.625rem', letterSpacing: '0.18em', textTransform: 'uppercase' }}
              >
                {t('eyebrow')}
              </p>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              className="mb-6 font-light text-[#1a1a1a]"
              style={{ fontSize: 'clamp(2.75rem, 6vw, 4.25rem)', lineHeight: 1.05, letterSpacing: '-0.01em' }}
            >
              {t('headlinePre')}
              <span style={{ fontFamily: 'var(--font-fraunces)', fontStyle: 'italic', fontWeight: 300 }}>
                {t('headlineItalic')}
              </span>
              {t('headlinePost')}
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="mb-8 text-base leading-[1.5] text-[#4a4a5a]"
              style={{ fontWeight: 300, maxWidth: '65ch' }}
            >
              {t('subtext')}
            </motion.p>

            <motion.div variants={fadeUp} className="mb-6 flex flex-wrap items-center gap-3">
              <CTAButton href="/signup" variant="primary" className="px-6 py-3 text-sm font-medium">
                {t('ctaPrimary')}
              </CTAButton>
              <CTAButton href="#how-it-works" variant="secondary" className="px-6 py-3 text-sm">
                {t('ctaSecondary')}
              </CTAButton>
            </motion.div>

            <motion.div
              variants={fadeUp}
              className="mb-6 flex flex-col divide-y divide-[#e8e3dc] sm:flex-row sm:divide-y-0 sm:divide-x"
            >
              {stats.map((stat, i) => (
                <div
                  key={stat.label}
                  className={`flex flex-col py-3 sm:py-0 ${i === 0 ? 'sm:pr-5' : i === stats.length - 1 ? 'sm:pl-5' : 'sm:px-5'}`}
                >
                  <span className="text-lg font-bold text-[#1a1a1a] tabular-nums leading-tight">
                    {stat.value}
                  </span>
                  <span className="text-[11px] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
                    {stat.label}
                  </span>
                </div>
              ))}
            </motion.div>

            <motion.p
              variants={fadeUp}
              className="text-[0.75rem] text-[#6b6b6b]"
              style={{ fontWeight: 400 }}
            >
              {t('trustLine')}
            </motion.p>
          </motion.div>

          {/* ── Right: story arc visual ── */}
          <motion.div
            initial={reduced ? {} : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] as const }}
            aria-hidden="true"
            className="flex flex-col"
          >
            <PhaseStrip phase={phase} loopKey={loopKey} reduced={reduced} />

            <div className="flex h-[420px] gap-3 lg:h-[460px]">
              <div className="flex-[3] min-w-0">
                <DashboardCard phase={phase} loopKey={loopKey} reduced={reduced} />
              </div>
              <div className="flex-[2] min-w-0">
                <CalendarPanel phase={phase} loopKey={loopKey} reduced={reduced} />
              </div>
            </div>

            {/* Annotations — desktop only */}
            <div className="hidden lg:flex gap-3 mt-2">
              {/* Annotation 1 — HITL: 0.75rem Ink Mist quand Phase 3 active */}
              <div className="flex-[3] min-w-0">
                <motion.div
                  initial={{ opacity: 0.45 }}
                  animate={{ opacity: phase === 3 ? 1 : 0.45 }}
                  transition={{ duration: reduced ? 0 : 0.35 }}
                  className="flex items-start gap-2 pt-2"
                >
                  <div className="flex flex-col items-center flex-shrink-0 mt-0.5">
                    <div className="w-px h-3 bg-[#e8e3dc]" />
                    <div className="h-1 w-1 rounded-full bg-[#e8e3dc]" />
                  </div>
                  <p
                    className="leading-[1.4] transition-[font-size,color] duration-300"
                    style={{
                      fontWeight: 300,
                      fontSize: phase === 3 ? '0.75rem' : '0.625rem',
                      color: phase === 3 ? '#4a4a5a' : '#9a9a9a',
                    }}
                  >
                    {t('annotationHITL')}
                    <span className="block text-[9px]">{t('annotationHITLSub')}</span>
                  </p>
                </motion.div>
              </div>

              {/* Annotation 2 — RDV payoff: 0.875rem Carbon Ink quand Phase 5 active */}
              <div className="flex-[2] min-w-0">
                <motion.div
                  initial={{ opacity: 0.45 }}
                  animate={{ opacity: phase === 5 ? 1 : 0.45 }}
                  transition={{ duration: reduced ? 0 : 0.35 }}
                  className="flex items-start gap-2 pt-2"
                >
                  <div className="flex flex-col items-center flex-shrink-0 mt-0.5">
                    <div className="w-px h-3 bg-[#e8e3dc]" />
                    <div className="h-1 w-1 rounded-full bg-[#e8e3dc]" />
                  </div>
                  <p
                    className="leading-[1.4] transition-[font-size,color] duration-300"
                    style={{
                      fontWeight: phase === 5 ? 400 : 300,
                      fontSize: phase === 5 ? '0.875rem' : '0.625rem',
                      color: phase === 5 ? '#1a1a1a' : '#9a9a9a',
                    }}
                  >
                    {t('annotationCalendar')}
                    <span className="block text-[9px]">{t('annotationCalendarSub')}</span>
                  </p>
                </motion.div>
              </div>
            </div>
          </motion.div>

        </div>
      </div>
    </section>
  );
}
