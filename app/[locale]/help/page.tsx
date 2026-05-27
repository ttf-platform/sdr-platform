import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Help Center — Mirvo',
  description: 'Documentation and guides for using Mirvo',
  metadataBase: new URL('https://mirvo.ai'),
  alternates: { canonical: '/help' },
}

const SECTIONS = [
  {
    title: 'Getting Started',
    description: 'Setup your account in 15 minutes',
    articles: ['How Mirvo works', '7-step setup walkthrough', 'Your Master ICP'],
    icon: '🚀',
  },
  {
    title: 'Sending Infrastructure',
    description: 'Domains, mailboxes, deliverability',
    articles: ['Adding a sending domain', 'Mailbox warmup explained', 'Why emails go to spam'],
    icon: '📨',
  },
  {
    title: 'Campaigns & AI',
    description: 'Creating high-reply outbound campaigns',
    articles: ['Create your first campaign', 'How AI writes personalized emails', 'Subject line best practices'],
    icon: '✨',
  },
  {
    title: 'Signals',
    description: 'Custom intent detection',
    articles: ['What are Signals?', 'Creating custom signals', 'Auto-scan & approval queue'],
    icon: '📡',
  },
  {
    title: 'Approval & Sending',
    description: 'Review AI emails before sending',
    articles: ['Approval Queue workflow', 'Editing AI variants', 'Launch campaign checklist'],
    icon: '✅',
  },
  {
    title: 'Billing & Account',
    description: 'Plans, quotas, troubleshooting',
    articles: ['Plans & pricing', 'Quotas explained', 'Troubleshooting common issues'],
    icon: '⚙️',
  },
]

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-[#f7f4f0]">
      <header className="border-b border-[#e5e0d6] bg-white">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/dashboard" className="text-sm text-[#6a6256] hover:text-[#1a1a2e] transition-colors">
            ← Back to dashboard
          </Link>
          <Link href="/" className="text-base font-bold text-[#1a1a2e]">
            Mir<span className="text-[#3b6bef]">vo</span>
          </Link>
          <div className="w-32" />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-[#1a1a2e]">Help Center</h1>
          <p className="text-lg text-[#6a6256] mt-3">
            Guides and documentation to help you get the most out of Mirvo
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {SECTIONS.map((section) => (
            <div
              key={section.title}
              className="bg-white border border-[#e5e0d6] rounded-xl p-5 hover:border-[#3b6bef] transition-colors"
            >
              <div className="text-3xl mb-3">{section.icon}</div>
              <h2 className="text-lg font-semibold text-[#1a1a2e]">{section.title}</h2>
              <p className="text-sm text-[#6a6256] mt-1">{section.description}</p>
              <ul className="mt-4 space-y-1.5">
                {section.articles.map((article) => (
                  <li key={article} className="text-sm text-[#8a7e6e] flex items-center gap-2">
                    <span className="text-xs text-[#b0a898]">→</span>
                    <span>{article}</span>
                    <span className="ml-auto text-[10px] bg-[#f0ece4] text-[#8a7e6e] px-1.5 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap">
                      Soon
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center p-6 bg-white border border-[#e5e0d6] rounded-xl">
          <p className="text-sm text-[#6a6256]">
            Articles are being written. Meanwhile, our AI assistant in the dashboard can answer most questions —
            click the help button bottom-right when logged in.
          </p>
        </div>
      </main>
    </div>
  )
}
