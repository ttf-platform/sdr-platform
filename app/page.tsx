import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[#f0ece6] sticky top-0 bg-white z-50">
        <span className="font-bold text-[#1a1a2e] text-xl">Sen<span className="text-[#3b6bef]">tra</span></span>
        <div className="flex gap-3 items-center">
          <Link href="/login" className="text-sm text-[#6b5e4e] hover:text-[#1a1a2e] px-3 py-2">Log in</Link>
          <Link href="/signup" className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold">Start Free Trial</Link>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-6 pt-16 pb-8 text-center">
        <div className="inline-block text-xs font-semibold text-[#3b6bef] bg-[#eef1fd] px-3 py-1.5 rounded-full mb-6 uppercase tracking-wider">Founding Member offer — only 50 spots left</div>
        <h1 className="text-5xl font-bold text-[#1a1a2e] mb-5 leading-tight">Pipeline without payroll</h1>
        <p className="text-lg text-[#6b5e4e] mb-8 leading-relaxed">Sentra is an autonomous AI agent that researches your prospects, writes personalized emails, and fills your pipeline — 24/7. It works at 3am. It never calls in sick.</p>
        <div className="flex gap-3 justify-center mb-3">
          <Link href="/signup" className="bg-[#3b6bef] text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-[#2d5bd4] transition-colors">Start free — no credit card →</Link>
        </div>
        <p className="text-xs text-[#8a7e6e]">14 days free · 1 campaign · 100 emails · cancel anytime</p>
      </div>

      <div className="max-w-3xl mx-auto px-6 pb-16">

        <div className="grid grid-cols-2 gap-4 mb-16">
          <div className="bg-[#f7f4f0] rounded-2xl p-6">
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-1">HUMAN SDR</div>
            <div className="text-4xl font-bold text-[#1a1a2e] mb-1">$6,000<span className="text-base font-normal text-[#8a7e6e]">/mo</span></div>
            <div className="text-xs text-[#8a7e6e] mb-4">per month + benefits + ramp time</div>
            <div className="flex flex-col gap-2">
              {['Works 8 hours/day','3-month ramp to productivity','50-80 emails/day capacity','Takes vacation, gets sick','Quits after 14 months (avg)'].map(t => (
                <div key={t} className="flex items-center gap-2 text-sm text-[#6b5e4e]"><span className="text-red-400">✕</span>{t}</div>
              ))}
            </div>
          </div>
          <div className="bg-[#eef1fd] border-2 border-[#3b6bef] rounded-2xl p-6 relative">
            <div className="text-xs font-bold text-[#3b6bef] uppercase tracking-wider mb-1">SENTRA</div>
            <div className="text-4xl font-bold text-[#1a1a2e] mb-1">$149<span className="text-base font-normal text-[#8a7e6e]">/mo</span></div>
            <div className="text-xs text-[#8a7e6e] mb-4">Founding member: $79 first 3 months</div>
            <div className="flex flex-col gap-2">
              {['Works 24/7/365','Productive in 10 minutes','500+ personalized emails/day','Never sleeps, never quits','GDPR-compliant by default','Built for founders, not enterprises'].map(t => (
                <div key={t} className="flex items-center gap-2 text-sm text-[#1a1a2e]"><span className="text-green-500">✓</span>{t}</div>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-16">
          <h2 className="text-2xl font-bold text-[#1a1a2e] text-center mb-2">How Sentra stacks up</h2>
          <p className="text-sm text-[#8a7e6e] text-center mb-8">Competitors give you Legos. Sentra gives you the finished house.</p>
          <div className="bg-white border border-[#e8e3dc] rounded-2xl overflow-hidden">
            <div className="grid grid-cols-4 bg-[#f7f4f0] px-5 py-3 border-b border-[#e8e3dc]">
              <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider col-span-2">Feature</div>
              <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider text-center">Competitors</div>
              <div className="text-xs font-bold text-[#3b6bef] uppercase tracking-wider text-center">Sentra</div>
            </div>
            {[
              ['Setup time', '2-4 weeks', '10 minutes'],
              ['Autonomy', 'Manual sequences', 'Fully autonomous'],
              ['Learning curve', 'High — needs RevOps', 'None — describe ICP, done'],
              ['Who it's for', 'Enterprise teams', 'Solo founders & small teams'],
              ['Pricing', 'Per seat + credits', 'Flat monthly'],
              ['Prospect research', 'Extra cost', 'Included'],
              ['Morning brief', 'Not available', 'Daily AI intelligence'],
              ['Call recording + CR', 'Extra tool needed', 'Built-in'],
            ].map(([feature, comp, sentra], i) => (
              <div key={feature} className={"grid grid-cols-4 px-5 py-3 border-b border-[#f0ece6] " + (i % 2 === 0 ? '' : 'bg-[#faf8f5]')}>
                <div className="text-sm text-[#1a1a2e] font-medium col-span-2">{feature}</div>
                <div className="text-sm text-[#8a7e6e] text-center">{comp}</div>
                <div className="text-sm text-[#3b6bef] font-semibold text-center">{sentra}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-16">
          {[
            { icon: '🔍', title: 'Deep prospect research', desc: 'Scans LinkedIn, news, job boards, and tech stacks to find real reasons to reach out.' },
            { icon: '🌍', title: 'Multilingual outreach', desc: 'Write in English, French, German, Spanish. Your AI SDR speaks your prospect's language.' },
            { icon: '🛡', title: 'GDPR-native', desc: 'Built in Europe, for Europe. Consent tracking and opt-out management baked in from day one.' },
            { icon: '🧠', title: 'Smart follow-ups', desc: 'Reads replies, handles objections, escalates hot leads. Knows when to push and when to back off.' },
            { icon: '☕', title: 'Daily intelligence', desc: 'Morning brief with pipeline status, reply rates, meeting bookings, and overnight activity.' },
            { icon: '⚡', title: '10-minute setup', desc: 'Describe your ideal customer. Connect your calendar. Sentra handles everything else.' },
          ].map(f => (
            <div key={f.title} className="flex gap-3">
              <span className="text-2xl flex-shrink-0">{f.icon}</span>
              <div>
                <div className="text-sm font-semibold text-[#1a1a2e] mb-1">{f.title}</div>
                <div className="text-sm text-[#8a7e6e] leading-relaxed">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-[#1a1a2e] mb-2">Start free. Scale fast.</h2>
          <p className="text-sm text-[#8a7e6e]">14 days on us. No credit card, no sales call, no commitment.</p>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-16">
          <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-1">FREE TRIAL</div>
            <div className="text-3xl font-bold text-[#1a1a2e] mb-1">$0</div>
            <div className="text-xs text-[#8a7e6e] mb-4">14 days free</div>
            <div className="flex flex-col gap-1.5 text-xs text-[#6b5e4e] mb-5">
              {['1 campaign','100 emails total','AI email generation','Open & reply tracking'].map(f => <div key={f}>✓ {f}</div>)}
            </div>
            <Link href="/signup" className="block text-center bg-[#f0ece6] text-[#1a1a2e] px-4 py-2 rounded-lg text-sm font-semibold">Start free trial →</Link>
          </div>
          <div className="bg-white border-2 border-[#3b6bef] rounded-xl p-5 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#3b6bef] text-white text-xs px-3 py-1 rounded-full font-semibold whitespace-nowrap">Most popular</div>
            <div className="text-xs font-bold text-[#3b6bef] uppercase tracking-wider mb-1">FOUNDING MEMBER</div>
            <div className="text-3xl font-bold text-[#1a1a2e] mb-0.5">$79<span className="text-sm font-normal text-[#8a7e6e]">/mo</span></div>
            <div className="text-xs text-[#8a7e6e] mb-4">First 3 months, then $149/mo</div>
            <div className="flex flex-col gap-1.5 text-xs text-[#6b5e4e] mb-5">
              {['Unlimited campaigns','500 emails/day','AI email generation','Advanced analytics','Multi-language outreach'].map(f => <div key={f}>✓ {f}</div>)}
            </div>
            <Link href="/signup" className="block text-center bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold">Claim founding spot →</Link>
          </div>
          <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-1">PRO</div>
            <div className="text-3xl font-bold text-[#1a1a2e] mb-1">$299<span className="text-sm font-normal text-[#8a7e6e]">/mo</span></div>
            <div className="text-xs text-[#8a7e6e] mb-4">For scaled outbound</div>
            <div className="flex flex-col gap-1.5 text-xs text-[#6b5e4e] mb-5">
              {['Everything in Growth','2,000 emails/day','Multi-mailbox rotation','Priority support','API access'].map(f => <div key={f}>✓ {f}</div>)}
            </div>
            <Link href="/signup" className="block text-center bg-[#f0ece6] text-[#1a1a2e] px-4 py-2 rounded-lg text-sm font-semibold">Get started →</Link>
          </div>
        </div>

        <div className="bg-[#1a1a2e] rounded-2xl p-8 text-center mb-16">
          <h2 className="text-2xl font-bold text-white mb-3">Your pipeline should run while you sleep</h2>
          <p className="text-sm text-[#8a7e6e] mb-6">Every morning, qualified meetings on your calendar. Every night, your AI agent working the pipeline. That's Sentra.</p>
          <Link href="/signup" className="inline-block bg-[#3b6bef] text-white px-6 py-3 rounded-xl text-sm font-semibold">Start your free trial →</Link>
          <p className="text-xs text-[#8a7e6e] mt-3">✓ Set up in 10 minutes · First campaigns go live within 48-72 hours</p>
        </div>

        <div className="text-center py-6 border-t border-[#f0ece6]">
          <p className="text-sm text-[#8a7e6e]">Sentra — AI-powered outbound sales. Built for founders.</p>
          <div className="flex gap-4 justify-center mt-3">
            <a href="#" className="text-xs text-[#8a7e6e] hover:text-[#1a1a2e]">Privacy Policy</a>
            <a href="#" className="text-xs text-[#8a7e6e] hover:text-[#1a1a2e]">Terms of Service</a>
          </div>
        </div>
      </div>
    </div>
  )
}