import type { Metadata } from 'next'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { LandingFooter } from '@/components/landing/LandingFooter'

export const metadata: Metadata = {
  title: 'Sending Policy — Sentra',
  description: 'Sentra sending policy: your responsibilities as a data controller, email requirements, and prohibited content.',
  metadataBase: new URL('https://sentra.app'),
  alternates: { canonical: '/legal/sending-policy' },
}

export default function SendingPolicyPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#faf8f5' }}>
      <LandingHeader />

      <main className="mx-auto max-w-3xl px-6 py-32 md:py-40">
        <p
          className="mb-4 uppercase"
          style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: '#888888' }}
        >
          Legal
        </p>
        <h1
          className="mb-3 tracking-tight"
          style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 500, color: '#1a1a1a', lineHeight: 1.15 }}
        >
          Sending Policy
        </h1>
        <p className="mb-12" style={{ fontSize: '0.875rem', color: '#888888' }}>
          Last updated: May 19, 2026 · Version 1.0
        </p>

        <div className="space-y-10" style={{ borderTop: '1px solid #e8e3dc', paddingTop: '3rem' }}>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Your role as data controller
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              When you import contacts into Sentra, you are the <strong style={{ color: '#1a1a1a' }}>data controller</strong>. Sentra acts solely as a data processor — we provide the technical infrastructure to run your campaigns, but we do not own or control your contact data.
            </p>
            <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              As data controller, you are responsible for ensuring your outbound complies with applicable law in your recipients' jurisdictions — including CAN-SPAM (US), GDPR (EU), PECR (UK), and CASL (Canada). Before sending, you must have a valid legal basis: legitimate interest for B2B prospecting is the most common, but it requires a genuine, documented justification.
            </p>
            <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              Sentra is designed exclusively for B2B outbound. Using it to contact consumers is a violation of this policy and applicable data protection law.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Mandatory email requirements
            </h2>
            <p className="mb-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              Every email sent through Sentra must meet the following requirements. Some are enforced automatically; others are your responsibility.
            </p>
            <ul className="space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              <li className="flex gap-3">
                <span style={{ color: '#3b6bef', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>Unsubscribe link.</strong> Each email must include a clear opt-out mechanism. Sentra inserts one automatically — do not remove or obfuscate it.</span>
              </li>
              <li className="flex gap-3">
                <span style={{ color: '#3b6bef', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>List-Unsubscribe header.</strong> One-click unsubscribe for Gmail and Outlook is handled automatically by Sentra.</span>
              </li>
              <li className="flex gap-3">
                <span style={{ color: '#3b6bef', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>Sender identification.</strong> Your emails must clearly identify you as the sender — including your name, company, and a valid physical address (required by CAN-SPAM).</span>
              </li>
              <li className="flex gap-3">
                <span style={{ color: '#3b6bef', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>Auto-stop on opt-out replies.</strong> Sentra automatically stops sending to any contact who replies with "stop", "unsubscribe", "remove me", "not interested", or equivalent.</span>
              </li>
              <li className="flex gap-3">
                <span style={{ color: '#3b6bef', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>Accurate subject lines.</strong> Subject lines must not be deceptive. They must reflect the content of the email.</span>
              </li>
              <li className="flex gap-3">
                <span style={{ color: '#3b6bef', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>No purchased lists.</strong> You may only contact prospects you have sourced through legitimate means. Rented or purchased bulk email lists are prohibited.</span>
              </li>
            </ul>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Prohibited content
            </h2>
            <p className="mb-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              The following content may not be sent through Sentra under any circumstances:
            </p>
            <ul className="space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              <li className="flex gap-3">
                <span style={{ color: '#3b6bef', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>Illegal or fraudulent content.</strong> Phishing, impersonation, financial scams, counterfeit offers, or any content that violates applicable law.</span>
              </li>
              <li className="flex gap-3">
                <span style={{ color: '#3b6bef', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>Regulated products.</strong> Non-prescription pharmaceuticals, unlicensed gambling services, securities promotions without proper disclosure, or other regulated categories.</span>
              </li>
              <li className="flex gap-3">
                <span style={{ color: '#3b6bef', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>Spam.</strong> Mass outreach with no genuine B2B relevance, purchased contact lists, or campaigns clearly designed to maximize volume over relevance.</span>
              </li>
              <li className="flex gap-3">
                <span style={{ color: '#3b6bef', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>Harassment or deceptive messaging.</strong> Content that is offensive, threatening, or intentionally misleading about your identity or the nature of your offer.</span>
              </li>
              <li className="flex gap-3">
                <span style={{ color: '#3b6bef', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>B2C outreach.</strong> Sentra is a B2B tool. Emailing consumers (individuals acting outside a professional capacity) is prohibited.</span>
              </li>
            </ul>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Enforcement
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              Sentra monitors aggregate sending metrics including complaint rates, bounce rates, and unsubscribe patterns. Accounts showing patterns consistent with spam will be suspended immediately, without prior notice.
            </p>
            <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              Suspension due to a sending policy violation does not entitle you to a refund for the unused portion of your subscription. Repeated or severe violations may result in permanent account termination and reporting to relevant authorities.
            </p>
            <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              We reserve the right to review sending activity and to request justification for campaign targeting decisions when patterns raise concerns.
            </p>
          </section>

          <section>
            <h2
              className="mb-4 tracking-tight"
              style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
            >
              Reporting abuse
            </h2>
            <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
              If you have received an email sent through Sentra that you believe violates this policy, please report it to{' '}
              <a
                href="mailto:abuse@sentra.app"
                className="transition-opacity hover:opacity-70"
                style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}
              >
                abuse@sentra.app
              </a>
              . Include the email headers if possible. We respond to all abuse reports within 72 hours and take enforcement action where warranted.
            </p>
          </section>

        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
