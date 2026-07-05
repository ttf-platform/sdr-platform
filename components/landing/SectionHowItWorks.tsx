'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';

// ─── Step card visuals (static, no translation needed) ────────────────────────

function ICPVisual() {
  const rows = [
    { label: 'Industry', value: 'SaaS' },
    { label: 'Size', value: '50–200 employees' },
    { label: 'Role', value: 'VP Sales' },
  ];
  return (
    <div className="mt-8 rounded-md bg-[#f5f2ee] border border-[#e8e3dc] p-4" aria-hidden="true">
      {rows.map((row, i) => (
        <div
          key={row.label}
          className={`flex items-center justify-between py-2 ${i < rows.length - 1 ? 'border-b border-dashed border-[#e8e3dc]' : ''}`}
        >
          <span className="text-[12px] text-[#1a1a1a]" style={{ fontWeight: 500 }}>{row.label}</span>
          <span className="text-[13px] text-[#1a1a1a]" style={{ fontWeight: 500 }}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function ActivityVisual() {
  const rows = [
    { dot: '#3b6bef', text: 'Sourced 47 prospects', time: 'Today', bold: false },
    { dot: '#3b6bef', text: 'Drafted 47 emails', time: 'Today', bold: false },
    { dot: '#d97706', text: 'Awaiting your approval', time: 'Now', bold: true },
  ];
  return (
    <div className="mt-8 rounded-md bg-[#f5f2ee] border border-[#e8e3dc] p-4 space-y-3" aria-hidden="true">
      {rows.map((row) => (
        <div key={row.text} className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: row.dot }} />
            <span className="text-[11px]" style={{ color: row.bold ? '#1a1a1a' : '#4a4a5a', fontWeight: row.bold ? 500 : 300 }}>
              {row.text}
            </span>
          </div>
          <span className="text-[10px] text-[#9a9a9a]">{row.time}</span>
        </div>
      ))}
      <div className="pt-2 border-t border-[#e8e3dc]">
        <div className="inline-block rounded border border-[#3b6bef] px-3 py-1" style={{ fontSize: '11px', fontWeight: 700, color: '#3b6bef', letterSpacing: '0.06em' }}>
          Approve all
        </div>
      </div>
    </div>
  );
}

function CalendarVisual() {
  return (
    <div className="mt-8 rounded-md bg-[#f5f2ee] border border-[#e8e3dc] p-4" aria-hidden="true">
      <div className="mb-2 uppercase text-[#4a4a5a]" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em' }}>
        Friday · 10:00
      </div>
      <div className="rounded-md bg-[#3b6bef] px-3 py-2 mb-2">
        <div className="text-[12px] font-medium text-white">Sarah Chen · Acme Corp</div>
        <div className="text-[10px] text-white" style={{ opacity: 0.8 }}>30 min · Discovery call</div>
      </div>
      <div className="mt-3 text-[11px] font-bold text-[#3b6bef]" style={{ letterSpacing: '0.06em' }}>
        ✓ Booked by Mirvo
      </div>
    </div>
  );
}

type VisualKey = 'icp' | 'activity' | 'calendar';

const visualMap: Record<VisualKey, React.ReactNode> = {
  icp: <ICPVisual />,
  activity: <ActivityVisual />,
  calendar: <CalendarVisual />,
};

// ─── Generic animated timeline ────────────────────────────────────────────────

interface TimelineNode {
  topLabel: string;
  action: string;
}

function HTimeline({
  nodes,
  loopDurationMs,
  holdMs = 1000,
}: {
  nodes: TimelineNode[];
  loopDurationMs: number;
  holdMs?: number;
}) {
  const reduced = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });
  const nodeCount = nodes.length;

  const [activeNode, setActiveNode] = useState(reduced ? nodeCount - 1 : -1);
  const [loopKey, setLoopKey] = useState(0);

  useEffect(() => {
    if (reduced) { setActiveNode(nodeCount - 1); return; }
    if (!isInView) return;

    setActiveNode(0);
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (let i = 1; i < nodeCount; i++) {
      const t = Math.round(loopDurationMs * (i / (nodeCount - 1)));
      timers.push(setTimeout(() => setActiveNode(i), t));
    }

    timers.push(
      setTimeout(() => {
        setActiveNode(-1);
        setLoopKey((k) => k + 1);
      }, loopDurationMs + holdMs)
    );

    return () => timers.forEach(clearTimeout);
  // nodes is built from translations — stable per render, safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInView, loopKey, reduced, nodeCount, loopDurationMs, holdMs]);

  const isActive = (i: number) => activeNode >= i;
  const isLast = (i: number) => i === nodeCount - 1;

  const dotStyle = (i: number) => ({
    width: isLast(i) ? 16 : 12,
    height: isLast(i) ? 16 : 12,
    marginTop: isLast(i) ? -2 : 0,
    backgroundColor: isActive(i) ? '#3b6bef' : '#ffffff',
    border: `2px solid ${isActive(i) ? '#3b6bef' : '#e8e3dc'}`,
    transition: 'background-color 0.3s ease, border-color 0.3s ease',
    boxShadow: isLast(i) && isActive(i)
      ? '0 4px 12px rgba(37,99,235,0.18), 0 0 0 4px rgba(37,99,235,0.10)'
      : 'none',
  });

  const topLabelStyle = (i: number): CSSProperties => ({
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: isActive(i) ? '#1a1a1a' : '#9a9a9a',
    transition: 'color 0.3s ease',
  });

  const actionStyle = (i: number): CSSProperties => ({
    fontSize: '12px',
    fontWeight: 300,
    lineHeight: 1.3,
    marginTop: 4,
    color: isActive(i) ? '#1a1a1a' : '#4a4a5a',
    transition: 'color 0.3s ease',
  });

  return (
    <div ref={ref} aria-hidden="true">

      {/* Desktop horizontal */}
      <div className="hidden lg:block relative pt-2 pb-14">
        <div className="absolute left-0 right-0 h-px bg-[#e8e3dc]" style={{ top: '14px' }} />

        <motion.div
          key={`bar-${loopKey}`}
          className="absolute left-0 bg-[#3b6bef]"
          style={{ top: '13px', height: '2px', originX: 0 }}
          initial={{ width: '0%' }}
          animate={{ width: reduced || isInView ? '100%' : '0%' }}
          transition={reduced ? { duration: 0 } : { duration: loopDurationMs / 1000, ease: 'linear' }}
        />

        <div className="relative flex justify-between">
          {nodes.map((node, i) => (
            <div key={i} className="flex flex-col items-center" style={{ maxWidth: 100 }}>
              <motion.div
                className="relative z-10 rounded-full"
                style={dotStyle(i)}
                animate={!reduced && isActive(i) && activeNode === i ? { scale: [1, 1.3, 1] } : { scale: 1 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as const }}
              />
              <div className="mt-4 text-center">
                <div style={topLabelStyle(i)}>{node.topLabel}</div>
                <div style={actionStyle(i)}>{node.action}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile vertical */}
      <div className="lg:hidden relative">
        <div className="absolute left-3 top-2 bottom-2 w-px bg-[#e8e3dc]" />

        <motion.div
          key={`vbar-${loopKey}`}
          className="absolute left-3 top-2 w-[2px] bg-[#3b6bef]"
          style={{ originY: 0 }}
          initial={{ height: '0%' }}
          animate={{ height: reduced || isInView ? '100%' : '0%' }}
          transition={reduced ? { duration: 0 } : { duration: loopDurationMs / 1000, ease: 'linear' }}
        />

        <div className="flex flex-col gap-5">
          {nodes.map((node, i) => (
            <div key={i} className="relative flex items-start">
              <div className="flex-shrink-0 w-6 flex items-center justify-center pt-0.5">
                <div
                  className="rounded-full relative z-10"
                  style={{
                    width: isLast(i) ? 14 : 10,
                    height: isLast(i) ? 14 : 10,
                    backgroundColor: isActive(i) ? '#3b6bef' : '#ffffff',
                    border: `2px solid ${isActive(i) ? '#3b6bef' : '#e8e3dc'}`,
                    transition: 'background-color 0.3s ease, border-color 0.3s ease',
                  }}
                />
              </div>
              <div className="pl-2">
                <div style={topLabelStyle(i)}>{node.topLabel}</div>
                <div style={{ ...actionStyle(i), fontSize: '13px', marginTop: 2 }}>{node.action}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ─── Warmup badge ─────────────────────────────────────────────────────────────

function WarmupBadge({ title, body }: { title: string; body: string }) {
  return (
    <>
      <style>{`
        @keyframes warmup-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.06); }
        }
        .warmup-arc-outer {
          animation: warmup-pulse 2.4s ease-in-out infinite;
          transform-origin: 12px 17px;
        }
        @media (prefers-reduced-motion: reduce) {
          .warmup-arc-outer { animation: none; }
        }
      `}</style>
      <motion.div
        className="mt-12 mb-12 mx-auto max-w-2xl"
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as const }}
      >
        <div
          className="flex flex-col items-center gap-4 py-6 px-8 sm:flex-row sm:items-start sm:gap-6"
          style={{ borderTop: '1px solid #e8e3dc', borderBottom: '1px solid #e8e3dc' }}
        >
          {/* Warmup signal icon */}
          <div className="flex-shrink-0" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#3b6bef"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="w-8 h-8 sm:w-6 sm:h-6"
            >
              <path className="warmup-arc-outer" d="M3 8a13 13 0 0 1 18 0" />
              <path d="M6 11a8 8 0 0 1 12 0" />
              <path d="M9 14a4 4 0 0 1 6 0" />
              <circle cx="12" cy="17" r="1" fill="#3b6bef" stroke="none" />
            </svg>
          </div>

          {/* Text */}
          <div className="text-left">
            <p className="text-base text-[#1a1a1a]" style={{ fontWeight: 500 }}>
              {title}
            </p>
            <p className="mt-1 text-[0.875rem] leading-[1.5] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
              {body}
            </p>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function SectionHowItWorks() {
  const t = useTranslations('landing.howItWorks');

  const steps = [
    {
      number: t('step0Number'),
      title: t('step0Title'),
      body: t('step0Body'),
      visual: 'icp' as VisualKey,
    },
    {
      number: t('step1Number'),
      title: t('step1Title'),
      body: t('step1Body'),
      visual: 'activity' as VisualKey,
    },
    {
      number: t('step2Number'),
      title: t('step2Title'),
      body: t('step2Body'),
      visual: 'calendar' as VisualKey,
    },
  ];

  const timelineANodes: TimelineNode[] = [
    { topLabel: t('timelineANode0Label'), action: t('timelineANode0Action') },
    { topLabel: t('timelineANode1Label'), action: t('timelineANode1Action') },
    { topLabel: t('timelineANode2Label'), action: t('timelineANode2Action') },
    { topLabel: t('timelineANode3Label'), action: t('timelineANode3Action') },
    { topLabel: t('timelineANode4Label'), action: t('timelineANode4Action') },
    { topLabel: t('timelineANode5Label'), action: t('timelineANode5Action') },
    { topLabel: t('timelineANode6Label'), action: t('timelineANode6Action') },
  ];

  const timelineBNodes: TimelineNode[] = [
    { topLabel: t('timelineBNode0Label'), action: t('timelineBNode0Action') },
    { topLabel: t('timelineBNode1Label'), action: t('timelineBNode1Action') },
    { topLabel: t('timelineBNode2Label'), action: t('timelineBNode2Action') },
    { topLabel: t('timelineBNode3Label'), action: t('timelineBNode3Action') },
  ];

  return (
    <section id="how-it-works" className="bg-[#f5f2ee] py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">

        {/* Section header */}
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const }}
        >
          <p className="mb-5 font-bold uppercase text-[#3b6bef]" style={{ fontSize: '0.625rem', letterSpacing: '0.18em' }}>
            {t('eyebrow')}
          </p>
          <h2
            className="mb-4 font-medium text-[#1a1a1a] mx-auto"
            style={{ fontSize: 'clamp(1.875rem, 4vw, 2.5rem)', lineHeight: 1.1, letterSpacing: '-0.01em', maxWidth: '36rem' }}
          >
            {t('headline')}
          </h2>
          <p className="text-base leading-[1.5] text-[#4a4a5a] mx-auto" style={{ fontWeight: 300, maxWidth: '42rem' }}>
            {t('subtext')}
          </p>
        </motion.div>

        {/* Step cards — 3-col grid desktop */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const, delay: i * 0.1 }}
              className="group rounded-lg bg-white border border-[#e8e3dc] p-8 flex flex-col transition-shadow duration-200 ease-out hover:shadow-[0_4px_12px_rgba(26,26,26,0.08),0_2px_4px_-2px_rgba(26,26,26,0.06)]"
              style={{ boxShadow: '0 1px 3px rgba(26,26,26,0.06), 0 1px 2px -1px rgba(26,26,26,0.06)' }}
            >
              <div className="mb-6 font-medium uppercase text-[#3b6bef]" style={{ fontSize: '14px', letterSpacing: '0.06em' }}>
                {step.number}
              </div>
              <h3 className="mb-3 font-medium text-[#1a1a1a]" style={{ fontSize: '1.25rem', lineHeight: 1.3 }}>
                {step.title}
              </h3>
              <p className="text-[0.9375rem] leading-[1.5] text-[#4a4a5a]" style={{ fontWeight: 300 }}>
                {step.body}
              </p>
              {visualMap[step.visual]}
            </motion.div>
          ))}
        </div>

        {/* ── Timelines ── */}
        <div className="mt-20">

          {/* Timeline A — Day 1: Under One Hour */}
          <motion.div
            className="text-center mb-10"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as const }}
          >
            <p className="font-bold uppercase text-[#3b6bef]" style={{ fontSize: '0.625rem', letterSpacing: '0.18em' }}>
              {t('timelineALabel')}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as const, delay: 0.08 }}
          >
            <HTimeline nodes={timelineANodes} loopDurationMs={9000} />
          </motion.div>

          {/* Warmup badge */}
          <WarmupBadge title={t('warmupTitle')} body={t('warmupBody')} />

          {/* Timeline B — Qualitative outbound cadence */}
          <motion.div
            className="text-center mt-12 mb-10"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as const }}
          >
            <p className="font-bold uppercase text-[#3b6bef]" style={{ fontSize: '0.625rem', letterSpacing: '0.16em' }}>
              {t('timelineBLabel')}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as const, delay: 0.08 }}
          >
            <HTimeline nodes={timelineBNodes} loopDurationMs={10000} />
          </motion.div>

          {/* Honest disclaimer */}
          <motion.p
            className="mt-8 text-center mx-auto"
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
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as const, delay: 0.1 }}
          >
            {t('disclaimer')}
          </motion.p>

        </div>

      </div>
    </section>
  );
}
