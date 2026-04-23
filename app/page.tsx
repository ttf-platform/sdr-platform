import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[#f0ece6]">
        <span className="font-bold text-[#1a1a2e] text-xl">Sen<span className="text-[#3b6bef]">tra</span></span>
        <div className="flex gap-3">
          <Link href="/login" className="text-sm text-[#6b5e4e] hover:text-[#1a1a2e] px-3 py-2">Log in</Link>
          <Link href="/signup" className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold">Start Free Trial</Link>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-16 text-center">
        <div className="text-xs font-semibold text-[#3b6bef] uppercase tracking-wider mb-4">Founding Member offer — only 50 spots left</div>
        <h1 className="text-4xl font-bold text-[#1a1a2e] mb-4 leading-tight">Pipeline without payroll</h1>
        <p className="text-lg text-[#6b5e4e] mb-8">Sentra is an autonomous AI agent that researches your prospects, writes personalized emails, and fills your pipeline — 24/7. It works at 3am. It never calls in sick.</p>
        <div className="flex gap-3 justify-center mb-4">
          <Link href="/signup" className="bg-[#3b6bef] text-white px-6 py-3 rounded-xl text-sm font-semibold">Start free — no credit card</Link>
        </div>
        <p className="text-xs text-[#8a7e6e]">14 days free · 1 campaign · 100 emails · cancel anytime</p>
      </div>

      <div className="max-w-3xl mx-auto px-6 pb-16">
        <div className="grid grid-cols-2 gap-6 mb-16">
          <div className="bg-[#f7f4f0] rounded-2xl p-6">
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-3">HUMAN SDR</div>
            <div className="text-3xl font-bold text-[#1a1a2e] mb-4">$6,000<span className="text-base font-normal text-[#8a7e6e]">/mo</span></div>
            <div className="flex flex-col gap-2 text-sm text-[#6b5e4e]">
              <div>Works 8 hours/day</div>
              <div>3-month ramp to productivity</div>
              <div>50-80 emails/day capacity</div>
              <div>Takes vacation, gets sick</div>
              <div>Quits after 14 months (avg)</div>
            </div>
          </div>
          <div className="bg-[#eef1fd] border-2 border-[#3b6bef] rounded-2xl p-6">
            <div className="text-xs font-bold text-[#3b6bef] uppercase tracking-wider mb-3">SENTRA</div>
            <div className="text-3xl font-bold text-[#1a1a2e] mb-4">$149<span className="text-base font-normal text-[#8a7e6e]">/mo</span></div>
            <div className="flex flex-col gap-2 text-sm text-[#6b5e4e]">
              <div>Works 24/7/365</div>
              <div>Productive in 10 minutes</div>
              <div>500+ personalized emails/day</div>
              <div>Never sleeps, never quits</div>
              <div>GDPR-compliant by default</div>
            </div>
          </div>
        </div>

        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-[#1a1a2e] mb-2">Start free. Scale fast.</h2>
          <p className="text-sm text-[#8a7e6e]">14 days on us. No credit card, no sales call, no commitment.</p>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-16">
          <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-2">FREE TRIAL</div>
            <div className="text-3xl font-bold text-[#1a1a2e] mb-4">$0<span className="text-sm font-normal text-[#8a7e6e]">/14 days</span></div>
            <div className="flex flex-col gap-1.5 text-xs text-[#6b5e4e] mb-4">
              <div>✓ 1 campaign</div>
              <div>✓ 100 emails total</div>
              <div>✓ AI email generation</div>
              <div>✓ Open & reply tracking</div>
            </div>
            <Link href="/signup" className="block text-center bg-[#f0ece6] text-[#1a1a2e] px-4 py-2 rounded-lg text-sm font-semibold">Start free trial →</Link>
          </div>
          <div className="bg-white border-2 border-[#3b6bef] rounded-xl p-5 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#3b6bef] text-white text-xs px-3 py-1 rounded-full font-semibold">Most popular</div>
            <div className="text-xs font-bold text-[#3b6bef] uppercase tracking-wider mb-2">FOUNDING MEMBER</div>
            <div className="text-3xl font-bold text-[#1a1a2e] mb-1">$79<span className="text-sm font-normal text-[#8a7e6e]">/mo</span></div>
            <div className="text-xs text-[#8a7e6e] mb-4">First 3 months, then $149/mo</div>
            <div className="flex flex-col gap-1.5 text-xs text-[#6b5e4e] mb-4">
              <div>✓ Unlimited campaigns</div>
              <div>✓ 500 emails/day</div>
              <div>✓ AI email generation</div>
              <div>✓ Advanced analytics</div>
              <div>✓ Multi-language outreach</div>
            </div>
            <Link href="/signup" className="block text-center bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold">Claim founding spot →</Link>
          </div>
          <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-2">PRO</div>
            <div className="text-3xl font-bold text-[#1a1a2e] mb-4">$299<span className="text-sm font-normal text-[#8a7e6e]">/mo</span></div>
            <div className="flex flex-col gap-1.5 text-xs text-[#6b5e4e] mb-4">
              <div>✓ Everything in Growth</div>
              <div>✓ 2,000 emails/day</div>
              <div>✓ Multi-mailbox rotation</div>
              <div>✓ Priority support</div>
              <div>✓ API access</div>
            </div>
            <Link href="/signup" className="block text-center bg-[#f0ece6] text-[#1a1a2e] px-4 py-2 rounded-lg text-sm font-semibold">Get started →</Link>
          </div>
        </div>

        <div className="text-center py-8 border-t border-[#f0ece6]">
          <p className="text-sm text-[#8a7e6e]">Sentra — AI-powered outbound sales.</p>
        </div>
      </div>
    </div>
  )
}