import Link from 'next/link'

const PLANS = [
  {
    id: 'starter', name: 'Starter', monthly: 149, yearly: 1430,
    features: ['100 prospects/mo','500 enrichments/mo','1 inbox','Booking page','Morning Brief','Basic AI emails'],
  },
  {
    id: 'pro', name: 'Pro', monthly: 299, yearly: 2870, popular: true,
    features: ['250 prospects/mo','1,000 enrichments/mo','2 inboxes','Advanced AI','Morning Brief Mode B','Priority support'],
  },
  {
    id: 'power', name: 'Power', monthly: 399, yearly: 3830,
    features: ['500 prospects/mo','2,000 enrichments/mo','3 inboxes','Premium AI + caching','All features'],
  },
]

const PRICING_FAQS = [
  { q: 'Do I need a credit card to start?',          a: 'No. Your 14-day trial starts the moment you sign up — no payment information required.' },
  { q: 'Can I change plans later?',                  a: 'Yes, any time. Upgrades take effect immediately. Downgrades apply at the next billing cycle.' },
  { q: 'What counts as a "prospect"?',               a: 'A prospect is a contact added to your outreach list. Enrichments (company data, LinkedIn, etc.) are counted separately.' },
  { q: 'What happens if I hit my monthly cap?',      a: 'By default, actions are blocked at 100% of your cap. You can enable overage for enrichments at $0.50/lead in your billing settings.' },
  { q: 'Is there an annual discount?',               a: 'Yes — pay yearly and save 20%. Starter $1,430/yr · Pro $2,870/yr · Power $3,830/yr.' },
  { q: 'What\'s your refund policy?',                a: 'If you\'re not satisfied in your first 30 days after upgrading, contact us and we\'ll make it right.' },
]

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#f5f2ee] font-sans">

      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-[#f0ece6]">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="font-bold text-[#1a1a2e] text-xl tracking-tight">
            Sen<span className="text-[#3b6bef]">tra</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-[#6b5e4e] hover:text-[#1a1a2e] px-3 py-2">Login</Link>
            <Link href="/signup" className="bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
              Start free trial
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-16 pb-10 px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-4xl font-bold text-[#1a1a2e] mb-3">Simple, honest pricing.</h1>
          <p className="text-lg text-[#4a4a5a] mb-2">14-day free trial on every plan. No credit card required.</p>
          <p className="text-sm text-green-600 font-semibold">🎉 Launch promo: use code LAUNCH50 at checkout</p>
        </div>
      </section>

      {/* Solo plans */}
      <section className="pb-16 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider text-center mb-6">Solo plans</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-start">
            {PLANS.map(p => (
              <div key={p.id} className={`rounded-2xl border p-6 relative ${p.popular ? 'bg-[#1a1a2e] border-[#1a1a2e]' : 'bg-white border-[#e8e3dc]'}`}>
                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-[#3b6bef] text-white text-xs font-bold px-3 py-1 rounded-full">Most popular</span>
                  </div>
                )}
                <div className={`text-sm font-bold uppercase tracking-wider mb-2 ${p.popular ? 'text-[#8a9ab8]' : 'text-[#8a7e6e]'}`}>{p.name}</div>
                <div className={`text-4xl font-bold mb-0.5 ${p.popular ? 'text-white' : 'text-[#1a1a2e]'}`}>
                  ${p.monthly}<span className={`text-lg font-normal ${p.popular ? 'text-[#8a9ab8]' : 'text-[#8a7e6e]'}`}>/mo</span>
                </div>
                <div className={`text-xs mb-6 ${p.popular ? 'text-[#8a9ab8]' : 'text-[#8a7e6e]'}`}>
                  or ${p.yearly}/yr <span className="text-green-400 font-semibold">(save 20%)</span>
                </div>
                <ul className={`flex flex-col gap-2.5 mb-8 text-sm ${p.popular ? 'text-[#c8d4e8]' : 'text-[#4a4a5a]'}`}>
                  {p.features.map(f => (
                    <li key={f} className="flex items-center gap-2">
                      <span className={p.popular ? 'text-[#3b6bef]' : 'text-green-500'}>✓</span>{f}
                    </li>
                  ))}
                </ul>
                <Link href={`/signup?plan=${p.id}`}
                  className={`block text-center w-full rounded-xl py-2.5 text-sm font-semibold transition-colors ${
                    p.popular
                      ? 'bg-[#3b6bef] hover:bg-[#2a5bdf] text-white'
                      : 'border border-[#3b6bef] text-[#3b6bef] hover:bg-[#3b6bef] hover:text-white'
                  }`}>
                  Start free trial
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team / Corporate */}
      <section className="pb-16 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider text-center mb-6">Teams & Enterprise</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
            {[
              { name: 'Team', desc: 'For 2–10 reps. Shared inbox, team analytics, manager dashboard.', label: 'Contact sales' },
              { name: 'Corporate', desc: 'Unlimited seats, SSO, dedicated CSM, SLA, custom data processing agreement.', label: 'Contact sales' },
            ].map(plan => (
              <div key={plan.name} className="bg-white border border-[#e8e3dc] rounded-2xl p-6 text-center">
                <div className="text-sm font-bold text-[#8a7e6e] uppercase tracking-wider mb-2">{plan.name}</div>
                <p className="text-sm text-[#4a4a5a] mb-6 leading-relaxed">{plan.desc}</p>
                <span className="inline-block border border-[#e8e3dc] text-[#6b5e4e] rounded-xl px-4 py-2 text-sm font-medium">
                  {plan.label} →
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison table note */}
      <section className="pb-10 px-6">
        <div className="max-w-3xl mx-auto bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-3">All plans include</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4 text-sm text-[#4a4a5a]">
            {['14-day free trial','No credit card to start','Public booking page','Morning Brief','AI email writing','Prospect dashboard','Reply classification','Cancel anytime','99.9% uptime SLA'].map(f => (
              <div key={f} className="flex items-center gap-2"><span className="text-green-500">✓</span>{f}</div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="pb-20 px-6">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-[#1a1a2e] text-center mb-8">Questions about pricing</h2>
          <div className="flex flex-col gap-3">
            {PRICING_FAQS.map((faq, i) => (
              <details key={i} className="group border border-[#e8e3dc] rounded-xl overflow-hidden">
                <summary className="flex items-center justify-between px-5 py-4 cursor-pointer bg-white hover:bg-[#faf8f5] text-sm font-semibold text-[#1a1a2e] list-none">
                  {faq.q}
                  <span className="text-[#8a7e6e] ml-4 text-lg group-open:rotate-45 transition-transform inline-block">+</span>
                </summary>
                <div className="px-5 pb-4 bg-white text-sm text-[#4a4a5a] leading-relaxed">{faq.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-[#1a1a2e] py-16 px-6 text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-4">Start free — no risk.</h2>
          <p className="text-[#8a9ab8] mb-6">14 days free on any plan. No credit card. Cancel anytime.</p>
          <Link href="/signup"
            className="inline-block bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-8 py-3.5 rounded-xl text-sm font-semibold transition-colors">
            Start 14-day free trial →
          </Link>
        </div>
      </section>

    </div>
  )
}
