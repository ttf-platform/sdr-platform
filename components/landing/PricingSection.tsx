import { CTAButton } from './CTAButton';

const PLANS = [
  {
    name: 'Starter',
    price: '$149',
    annual: '$1,490/yr',
    annualNote: '2 months free',
    tagline: 'For founders making their first 100 cold reaches',
    features: [
      '5,000 prospects sourced',
      '5,000 emails/month',
      '500 enrichment credits/month',
      'All AI features included',
      'Email support',
    ],
    cta: 'Start free trial',
    highlighted: false,
    badge: null,
  },
  {
    name: 'Pro',
    price: '$299',
    annual: '$2,990/yr',
    annualNote: '2 months free',
    tagline: 'For startups scaling outbound past first traction',
    features: [
      '25,000 prospects sourced',
      '25,000 emails/month',
      '2,000 enrichment credits/month',
      'All AI features included',
      'Priority support',
    ],
    cta: 'Start free trial',
    highlighted: true,
    badge: 'Most popular',
  },
  {
    name: 'Power',
    price: '$399',
    annual: '$3,990/yr',
    annualNote: '2 months free',
    tagline: 'For sales teams who need volume without losing quality',
    features: [
      '100,000 prospects sourced',
      '100,000 emails/month',
      '5,000 enrichment credits/month',
      'All AI features included',
      'Dedicated success manager',
    ],
    cta: 'Start free trial',
    highlighted: false,
    badge: null,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="py-24 bg-[#faf8f5]">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Section header */}
        <div className="text-center mb-16">
          <div className="inline-block text-[10px] font-bold uppercase tracking-[0.18em] text-[#2563eb] mb-5">
            Pricing
          </div>
          <h2
            className="text-4xl lg:text-5xl font-light text-[#1a1a1a] mb-5 leading-tight"
            style={{ fontFamily: 'var(--font-fraunces)', fontStyle: 'italic' }}
          >
            Pick a plan. Start free.{' '}
            <span className="text-[#4a4a5a]">No surprises.</span>
          </h2>
          <p className="text-base lg:text-lg text-[#4a4a5a] max-w-xl mx-auto leading-relaxed">
            All plans include sourcing, writing, sending, deliverability, follow-ups, and meeting booking.
            The only difference is volume.
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-2xl p-7 transition-all duration-200 ${
                plan.highlighted
                  ? 'border-2 border-[#2563eb] bg-white shadow-xl shadow-blue-100/40 scale-[1.02] z-10'
                  : 'border border-[#e8e3dc] bg-white hover:shadow-md hover:border-[#d4cec7]'
              }`}
            >
              {/* Badge */}
              {plan.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-20">
                  <span className="inline-flex items-center rounded-full bg-[#2563eb] px-3.5 py-1 text-[11px] font-semibold text-white shadow-sm shadow-blue-200">
                    {plan.badge}
                  </span>
                </div>
              )}

              {/* Plan name */}
              <div className="flex items-center justify-between mb-5">
                <span className="text-xs font-semibold uppercase tracking-widest text-[#9a9a9a]">
                  {plan.name}
                </span>
              </div>

              {/* Price */}
              <div className="mb-1 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-[#1a1a1a] tracking-tight">{plan.price}</span>
                <span className="text-sm text-[#9a9a9a] ml-0.5">/mo</span>
              </div>
              <div className="text-xs text-[#9a9a9a] mb-3">
                or {plan.annual} — {plan.annualNote}
              </div>

              {/* Tagline */}
              <p className="text-sm text-[#4a4a5a] mb-6 leading-relaxed border-b border-[#f0ebe4] pb-6">
                {plan.tagline}
              </p>

              {/* Features */}
              <ul className="space-y-2.5 mb-7">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-[#1a1a1a]">
                    <span
                      className={`mt-0.5 flex-shrink-0 h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                        plan.highlighted
                          ? 'bg-[#eff6ff] text-[#2563eb]'
                          : 'bg-[#f5f2ee] text-[#4a4a5a]'
                      }`}
                    >
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <CTAButton
                href="/signup"
                variant={plan.highlighted ? 'primary' : 'secondary'}
                className="w-full justify-center"
              >
                {plan.cta}
              </CTAButton>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <div className="mt-10 text-center">
          <p className="text-sm text-[#9a9a9a]">
            All plans include 14-day free trial. No credit card required. Cancel anytime.{' '}
            <a
              href="/pricing"
              className="text-[#4a4a5a] underline underline-offset-2 hover:text-[#1a1a1a] transition-colors"
            >
              Full pricing details →
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
