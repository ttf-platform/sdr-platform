'use client'
import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { motion } from 'framer-motion'

// ─── Animation helpers ────────────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.55, ease: 'easeOut' } },
}
const fadeIn = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { duration: 0.6, ease: 'easeOut' } },
}

// ─── FAQ Accordion ────────────────────────────────────────────────────────────
const FAQS = [
  {
    q: 'Do I need to write any emails myself?',
    a: 'No. Sentra writes all of them based on your profile. You can review, approve, or edit before sending.',
  },
  {
    q: 'What happens to my email reputation?',
    a: 'Sentra is built around inbox reputation. From day one, your emails land in inbox — not spam. We handle the technical complexity of email deliverability so your real inbox stays trusted, day one and forever.',
  },
  {
    q: 'Can I review emails before they go out?',
    a: 'Yes. Approval mode is on by default. You can also turn it off later if you trust the AI.',
  },
  {
    q: 'What if a prospect replies?',
    a: 'Replies land in your Sentra inbox, automatically sorted by intent so you can focus on the warm ones. Your real inbox stays clean.',
  },
  {
    q: 'Is my data safe?',
    a: 'Your data is yours. We never sell it, we never train models on it.',
  },
]

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-[#e8e3dc] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left bg-white hover:bg-[#faf8f5] transition-colors"
      >
        <span className="font-semibold text-[#1a1a2e] text-sm pr-4">{q}</span>
        <span className="text-[#8a7e6e] flex-shrink-0 text-lg leading-none">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="px-5 pb-4 bg-white">
          <p className="text-sm text-[#4a4a5a] leading-relaxed">{a}</p>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function HomePage() {
  return (
    <div className="min-h-screen bg-white font-sans">

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-[#f0ece6]">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="font-bold text-[#1a1a2e] text-xl tracking-tight">
            Sen<span className="text-[#3b6bef]">tra</span>
          </span>
          <div className="flex items-center gap-1 sm:gap-3">
            <a href="#pricing" className="hidden sm:block text-sm text-[#6b5e4e] hover:text-[#1a1a2e] px-3 py-2 transition-colors">Pricing</a>
            <Link href="/login" className="text-sm text-[#6b5e4e] hover:text-[#1a1a2e] px-3 py-2 transition-colors">Login</Link>
            <Link href="/signup" className="bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
              Start free trial
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-b from-white to-[#f9f6f1] pt-20 pb-24 px-6 text-center">
        <div className="max-w-4xl mx-auto">
          <motion.div variants={fadeUp} initial="hidden" animate="show">
            <span className="inline-block text-sm font-semibold text-[#3b6bef] bg-blue-50 px-3 py-1 rounded-full mb-6">
              Outbound that runs itself
            </span>
          </motion.div>
          <motion.h1
            variants={fadeUp} initial="hidden" animate="show"
            transition={{ delay: 0.1 }}
            className="text-4xl sm:text-5xl font-bold text-[#1a1a2e] leading-tight mb-6"
          >
            The first AI SDR that actually books<br className="hidden sm:block" /> meetings while you sleep.
          </motion.h1>
          <motion.p
            variants={fadeUp} initial="hidden" animate="show"
            transition={{ delay: 0.2 }}
            className="text-lg text-[#4a4a5a] max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            Sentra researches your prospects, writes personalized emails, sends them, handles replies, and prepares your morning briefing. You wake up to meetings on the calendar.
          </motion.p>
          <motion.div
            variants={fadeUp} initial="hidden" animate="show"
            transition={{ delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-4"
          >
            <Link href="/signup"
              className="w-full sm:w-auto bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-8 py-3.5 rounded-xl text-base font-semibold transition-colors shadow-md shadow-blue-200">
              Start 14-day free trial
            </Link>
          </motion.div>
          <motion.p
            variants={fadeUp} initial="hidden" animate="show"
            transition={{ delay: 0.35 }}
            className="text-xs text-[#8a7e6e]"
          >
            No credit card required. Cancel anytime.
          </motion.p>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────────── */}
      <section className="bg-[#f5f2ee] py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.h2
            variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
            className="text-3xl font-bold text-[#1a1a2e] text-center mb-12"
          >
            How it works
          </motion.h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { icon: '⚙️', title: 'Set it up', body: 'Add your product, ICP, and tone. Sentra learns your business in minutes.' },
              { icon: '🌙', title: 'Sentra works overnight', body: 'Research, writing, sending, reply handling. All while you sleep.' },
              { icon: '☕', title: 'Wake up to meetings', body: "Your morning brief. Today's calendar. Ready to close." },
            ].map((card, i) => (
              <motion.div
                key={card.title}
                variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-white border border-[#e8e3dc] rounded-xl p-6"
              >
                <div className="text-3xl mb-4">{card.icon}</div>
                <h3 className="font-bold text-[#1a1a2e] mb-2">{card.title}</h3>
                <p className="text-sm text-[#4a4a5a] leading-relaxed">{card.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature highlights ──────────────────────────────────────────────── */}
      <section className="py-24 px-6 bg-white">
        <div className="max-w-5xl mx-auto flex flex-col gap-24">

          {/* Section A — Morning Brief */}
          <motion.div
            variants={fadeIn} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }}
            className="flex flex-col md:flex-row items-center gap-10 md:gap-16"
          >
            <div className="w-full md:w-1/2 rounded-2xl overflow-hidden border border-[#e8e3dc] shadow-lg flex-shrink-0">
              <Image
                src="/landing/morning-brief.svg"
                alt="Morning Brief — daily intelligence brief with prospect dossiers"
                width={600} height={375}
                className="w-full h-auto"
                priority
              />
            </div>
            <div className="w-full md:w-1/2">
              <span className="text-xs font-bold text-[#3b6bef] uppercase tracking-wider">Morning Brief</span>
              <h2 className="text-2xl sm:text-3xl font-bold text-[#1a1a2e] mt-2 mb-4 leading-tight">
                Wake up to your daily intelligence brief.
              </h2>
              <p className="text-[#4a4a5a] leading-relaxed">
                Every morning, Sentra prepares a brief tailored to your day. If you have meetings, you get a research dossier on each prospect — pain points, talking points, discovery questions. If you don&apos;t, you get market intelligence and 3 fresh campaign ideas tailored to your ICP.
              </p>
            </div>
          </motion.div>

          {/* Section B — Settings / AI quality */}
          <motion.div
            variants={fadeIn} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }}
            className="flex flex-col md:flex-row-reverse items-center gap-10 md:gap-16"
          >
            <div className="w-full md:w-1/2 rounded-2xl overflow-hidden border border-[#e8e3dc] shadow-lg flex-shrink-0">
              <Image
                src="/landing/settings.svg"
                alt="Settings — AI profile quality score and company profile"
                width={600} height={375}
                className="w-full h-auto"
              />
            </div>
            <div className="w-full md:w-1/2">
              <span className="text-xs font-bold text-[#3b6bef] uppercase tracking-wider">AI Profile</span>
              <h2 className="text-2xl sm:text-3xl font-bold text-[#1a1a2e] mt-2 mb-4 leading-tight">
                AI that knows your business, not just your industry.
              </h2>
              <p className="text-[#4a4a5a] leading-relaxed">
                The more Sentra knows about your business, the better it writes. Profile quality score shows you exactly how to unlock premium AI outputs. Specific to your voice, your offer, your ICP — never generic.
              </p>
            </div>
          </motion.div>

          {/* Section C — Meetings */}
          <motion.div
            variants={fadeIn} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }}
            className="flex flex-col md:flex-row items-center gap-10 md:gap-16"
          >
            <div className="w-full md:w-1/2 rounded-2xl overflow-hidden border border-[#e8e3dc] shadow-lg flex-shrink-0">
              <Image
                src="/landing/meetings.svg"
                alt="Meetings — booking page and dashboard"
                width={600} height={375}
                className="w-full h-auto"
              />
            </div>
            <div className="w-full md:w-1/2">
              <span className="text-xs font-bold text-[#3b6bef] uppercase tracking-wider">Booking</span>
              <h2 className="text-2xl sm:text-3xl font-bold text-[#1a1a2e] mt-2 mb-4 leading-tight">
                Meetings on autopilot.
              </h2>
              <p className="text-[#4a4a5a] leading-relaxed">
                Prospects book directly into your calendar — no back and forth. You get the meeting time, the prospect notes, and a research dossier ready to read with your morning coffee.
              </p>
            </div>
          </motion.div>

        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────────── */}
      <section id="pricing" className="bg-[#f5f2ee] py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div
            variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold text-[#1a1a2e] mb-3">Simple pricing. No surprises.</h2>
            <p className="text-[#4a4a5a]">14-day free trial on every plan. No credit card required.</p>
          </motion.div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-start">

            {/* Starter */}
            <motion.div
              variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
              transition={{ delay: 0 }}
              className="bg-white border border-[#e8e3dc] rounded-2xl p-6"
            >
              <div className="text-sm font-bold text-[#8a7e6e] uppercase tracking-wider mb-2">Starter</div>
              <div className="text-4xl font-bold text-[#1a1a2e] mb-1">$149<span className="text-lg font-normal text-[#8a7e6e]">/mo</span></div>
              <p className="text-xs text-[#8a7e6e] mb-6">For solo SDRs getting started</p>
              <ul className="flex flex-col gap-2.5 mb-8 text-sm text-[#4a4a5a]">
                {['100 prospects/mo','1 inbox','Basic AI emails','Booking page','Morning Brief'].map(f => (
                  <li key={f} className="flex items-center gap-2"><span className="text-green-500 font-bold">✓</span>{f}</li>
                ))}
              </ul>
              <Link href="/signup" className="block text-center w-full border border-[#3b6bef] text-[#3b6bef] hover:bg-[#3b6bef] hover:text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
                Start free trial
              </Link>
            </motion.div>

            {/* Pro — highlighted */}
            <motion.div
              variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="bg-[#1a1a2e] border border-[#1a1a2e] rounded-2xl p-6 relative"
            >
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-[#3b6bef] text-white text-xs font-bold px-3 py-1 rounded-full">Most popular</span>
              </div>
              <div className="text-sm font-bold text-[#8a9ab8] uppercase tracking-wider mb-2">Pro</div>
              <div className="text-4xl font-bold text-white mb-1">$199<span className="text-lg font-normal text-[#8a9ab8]">/mo</span></div>
              <p className="text-xs text-[#8a9ab8] mb-6">For SDRs who want the best AI</p>
              <ul className="flex flex-col gap-2.5 mb-8 text-sm text-[#c8d4e8]">
                {['250 prospects/mo','2 inboxes','Advanced AI','Morning Brief Mode B','Priority support'].map(f => (
                  <li key={f} className="flex items-center gap-2"><span className="text-[#3b6bef] font-bold">✓</span>{f}</li>
                ))}
              </ul>
              <Link href="/signup" className="block text-center w-full bg-[#3b6bef] hover:bg-[#2a5bdf] text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
                Start free trial
              </Link>
            </motion.div>

            {/* Power */}
            <motion.div
              variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="bg-white border border-[#e8e3dc] rounded-2xl p-6"
            >
              <div className="text-sm font-bold text-[#8a7e6e] uppercase tracking-wider mb-2">Power</div>
              <div className="text-4xl font-bold text-[#1a1a2e] mb-1">$249<span className="text-lg font-normal text-[#8a7e6e]">/mo</span></div>
              <p className="text-xs text-[#8a7e6e] mb-6">For high-volume outbound teams</p>
              <ul className="flex flex-col gap-2.5 mb-8 text-sm text-[#4a4a5a]">
                {['500 prospects/mo','3 inboxes','Premium AI + caching','All features'].map(f => (
                  <li key={f} className="flex items-center gap-2"><span className="text-green-500 font-bold">✓</span>{f}</li>
                ))}
              </ul>
              <Link href="/signup" className="block text-center w-full border border-[#3b6bef] text-[#3b6bef] hover:bg-[#3b6bef] hover:text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
                Start free trial
              </Link>
            </motion.div>

          </div>
          <p className="text-center text-sm text-[#8a7e6e] mt-8">
            Need more?{' '}
            <span className="text-[#4a4a5a] font-medium">See Team &amp; Corporate plans →</span>
          </p>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────────── */}
      <section className="bg-white py-24 px-6">
        <div className="max-w-2xl mx-auto">
          <motion.h2
            variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
            className="text-3xl font-bold text-[#1a1a2e] text-center mb-12"
          >
            Questions
          </motion.h2>
          <div className="flex flex-col gap-3">
            {FAQS.map((faq, i) => (
              <motion.div
                key={i}
                variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
              >
                <FaqItem q={faq.q} a={faq.a} />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────────── */}
      <section className="bg-[#1a1a2e] py-24 px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <motion.h2
            variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
            className="text-3xl sm:text-4xl font-bold text-white mb-6 leading-tight"
          >
            Stop chasing leads.<br />Start meeting them.
          </motion.h2>
          <motion.div
            variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
            transition={{ delay: 0.1 }}
          >
            <Link href="/signup"
              className="inline-block bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-10 py-4 rounded-xl text-base font-semibold transition-colors shadow-lg shadow-blue-900/30 mb-4">
              Start 14-day free trial — no credit card
            </Link>
          </motion.div>
          <motion.p
            variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="text-sm text-[#8a9ab8]"
          >
            Set up in 5 minutes. Cancel anytime.
          </motion.p>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="bg-[#f5f2ee] border-t border-[#e8e3dc] py-12 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-2 sm:grid-cols-3 gap-8 mb-10">
          <div>
            <div className="font-bold text-[#1a1a2e] text-lg mb-2">
              Sen<span className="text-[#3b6bef]">tra</span>
            </div>
            <p className="text-xs text-[#8a7e6e] leading-relaxed">Outbound that runs itself.</p>
          </div>
          <div>
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-3">Product</div>
            <ul className="flex flex-col gap-2 text-sm text-[#6b5e4e]">
              <li><a href="#pricing" className="hover:text-[#1a1a2e] transition-colors">Pricing</a></li>
              <li><a href="#" className="hover:text-[#1a1a2e] transition-colors">How it works</a></li>
              <li><Link href="/login" className="hover:text-[#1a1a2e] transition-colors">Login</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-3">Trust</div>
            <ul className="flex flex-col gap-2 text-sm text-[#6b5e4e]">
              <li><a href="/trust" className="hover:text-[#1a1a2e] transition-colors">Privacy</a></li>
              <li><a href="/trust" className="hover:text-[#1a1a2e] transition-colors">Terms</a></li>
              <li><a href="/trust" className="hover:text-[#1a1a2e] transition-colors">Security</a></li>
            </ul>
          </div>
        </div>
        <div className="max-w-5xl mx-auto border-t border-[#e8e3dc] pt-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-xs text-[#b0a898]">© 2026 Sentra. All rights reserved.</p>
          <p className="text-xs text-[#b0a898]">Built for the outbound-obsessed founder.</p>
        </div>
      </footer>

    </div>
  )
}
