import type { Metadata, Route } from 'next'
import Link from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'

export const metadata: Metadata = {
  title: 'Terms of Service — Mirvo',
  description: 'Terms governing your use of the Mirvo platform.',
  metadataBase: new URL('https://mirvo.ai'),
  alternates: { canonical: '/legal/terms' },
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('legal')
  return (
    <>
      <p
        className="mb-4 uppercase"
        style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: '#666677' }}
      >
        {t('eyebrow')}
      </p>
      <h1
        className="mb-3 tracking-tight"
        style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 500, color: '#1a1a1a', lineHeight: 1.15 }}
      >
        {t('termsTitle')}
      </h1>
      <p className="mb-12" style={{ fontSize: '0.875rem', color: '#666677' }}>
        {t('lastUpdated')}
      </p>

      <div className="space-y-10" style={{ borderTop: '1px solid #e8e3dc', paddingTop: '3rem' }}>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            1. Acceptance
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            By creating an account or using the Mirvo Service, you agree to be bound by these Terms of Service, our{' '}
            <Link href={"/legal/privacy" as Route} style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Privacy Policy</Link>,{' '}
            <Link href={"/legal/cookies" as Route} style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Cookie Policy</Link>,{' '}
            <Link href={"/legal/sending-policy" as Route} style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Sending Policy</Link>, and, where applicable, our{' '}
            <Link href={"/legal/dpa" as Route} style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Data Processing Addendum</Link>.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            If you are accepting on behalf of a company or legal entity, you represent that you have authority to bind that entity to these Terms.
          </p>
        </section>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            2. Definitions
          </h2>
          <div className="space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            {[
              ['User', 'Any individual who accesses or uses the Service under a Subscriber account.'],
              ['Subscriber', 'The entity or individual that has purchased a subscription to the Service.'],
              ['Service', 'The Mirvo B2B outbound platform, including all features, APIs, and integrations provided via mirvo.ai.'],
              ['Subscription', 'A recurring plan that grants access to the Service for a defined billing period.'],
              ['Content', 'Any data, text, templates, or campaign materials created or uploaded by the Subscriber.'],
              ['Data', 'Any personal or business information processed through the Service, including imported prospect contact data.'],
            ].map(([term, def]) => (
              <div key={term as string} className="flex gap-3">
                <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>{term}:</strong> {def}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            3. Account creation and security
          </h2>
          <ul className="space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>Eligibility.</strong> You must be at least 18 years old and using the Service for professional B2B purposes. The Service is not intended for personal or consumer use.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>Accuracy.</strong> You agree to provide accurate, complete information at signup and to keep it up to date. False or misleading registration information is grounds for account termination.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>Account security.</strong> You are responsible for keeping your credentials confidential and for all activity that occurs under your account. Notify us immediately of any unauthorized access at{' '}
                <a href="mailto:security@mirvo.ai" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>security@mirvo.ai</a>.
              </span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>No account sharing.</strong> Subscriptions are for a single workspace. Sharing access credentials with individuals outside your organization is prohibited.</span>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            4. Subscription plans and billing
          </h2>
          <div className="space-y-5">
            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Plans and pricing</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                Mirvo offers multiple subscription tiers (Starter, Pro, Power). Current pricing and feature details are available on the pricing page. Mirvo reserves the right to change pricing with 30 days&apos; notice.
              </p>
            </div>
            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Free trial</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                New users may access a 14-day Power plan trial. No credit card is required during the trial period. At the end of the trial, access is suspended unless a subscription is purchased.
              </p>
            </div>
            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Billing and renewal</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                Subscriptions are billed monthly or annually via Stripe and auto-renew at the end of each billing cycle. You will receive an invoice by email for each charge.
              </p>
            </div>
            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Plan changes</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                Upgrades take effect immediately with prorated billing. Downgrades take effect at the end of the current billing cycle.
              </p>
            </div>
            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Cancellation and refunds</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                You may cancel at any time from billing settings. Cancellation takes effect at the end of the current billing period — you retain access until then. We do not provide refunds for unused portions of prepaid subscription periods unless the Service experienced a material failure attributable to Mirvo.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            5. Acceptable use
          </h2>
          <p className="mb-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            You agree to use Mirvo only for lawful B2B purposes. Specifically, you must:
          </p>
          <ul className="space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed">Comply with all applicable laws, including GDPR (EU), CAN-SPAM (US), PECR (UK), and CASL (Canada) in every jurisdiction you send to.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed">Adhere to our{' '}
                <Link href={"/legal/sending-policy" as Route} style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Sending Policy</Link>
                , including prohibitions on spam, purchased lists, and B2C outreach.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed">Not exceed your plan&apos;s sending or prospect limits through technical workarounds.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed">Not attempt to circumvent security measures, rate limits, or access controls.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed">Not use the Service for illegal, fraudulent, harassing, or deceptive purposes.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed">Not resell, sublicense, or white-label the Service without explicit written permission from Mirvo.</span>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            6. Your content and data
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            You retain full ownership of all content and data you create or import into Mirvo — campaigns, email templates, prospect data, and inbox messages. By using the Service, you grant Mirvo a limited, non-exclusive license to process this content solely to deliver the Service to you.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Mirvo does not claim ownership over your content, does not use it to train AI models, and does not share it with third parties except as required to operate the Service (see our{' '}
            <Link href={"/legal/dpa" as Route} style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Data Processing Addendum</Link>
            ).
          </p>
        </section>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            7. Intellectual property
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Mirvo and its licensors own all intellectual property rights in the Service — including the software, interface, design, documentation, and branding. These Terms do not transfer any IP ownership to you.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            During your active subscription, Mirvo grants you a limited, non-exclusive, non-transferable license to access and use the Service for your internal business purposes. This license ends when your subscription ends.
          </p>
        </section>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            8. AI output disclaimer
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            AI-generated email drafts and suggestions provided by Mirvo are decision-support tools. They are not legal advice, and their accuracy or suitability for your specific context is not guaranteed.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            You are responsible for reviewing all AI-generated content before sending and for ensuring it complies with applicable laws in your jurisdiction — including requirements around truthful identification, unsubscribe mechanisms, and data subject rights under CAN-SPAM, GDPR, and similar regulations.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            As the data controller for your outbound campaigns, you retain full responsibility for the legality and appropriateness of emails sent through Mirvo. Mirvo&apos;s role is that of a data processor providing technical infrastructure.
          </p>
        </section>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            9. Suspension and termination
          </h2>
          <p className="mb-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Mirvo may suspend or terminate your account in the following circumstances:
          </p>
          <ul className="space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            {[
              'Material breach of these Terms or our Sending Policy',
              'Non-payment of subscription fees after a 7-day grace period',
              'Patterns of spam complaints, abnormal bounce rates, or abuse reports',
              'Requests by law enforcement or regulatory authorities',
              'Account inactivity exceeding 12 months (with 30 days\' prior notice)',
            ].map((item) => (
              <li key={item} className="flex gap-3">
                <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            In cases of urgent risk (active spam campaigns, security threat), suspension may occur immediately without notice. Where no urgency exists, we will provide 5 days&apos; notice and an opportunity to remedy the breach before suspension.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            No refund is issued for account suspensions or terminations resulting from your breach of these Terms.
          </p>
        </section>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            10. Service availability and modifications
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Mirvo aims for high availability and takes reliability seriously. However, we do not provide a contractual SLA at this stage. Planned maintenance will be communicated in advance.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Mirvo may modify, add, or remove features with reasonable notice. Material changes that reduce core functionality will be communicated at least 60 days in advance, giving you the opportunity to cancel without penalty.
          </p>
        </section>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            11. Disclaimer of warranties
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind, express or implied — including but not limited to merchantability, fitness for a particular purpose, or non-infringement.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Mirvo does not warrant that AI-generated output will be accurate, legally compliant, or appropriate for your specific situation or jurisdiction. You are responsible for reviewing all output before acting on it.
          </p>
        </section>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            12. Limitation of liability
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            To the maximum extent permitted by applicable law, Mirvo&apos;s total liability to you for any claim arising under these Terms is capped at the total fees you paid to Mirvo in the 12 months preceding the claim.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Mirvo is not liable for indirect, incidental, consequential, or punitive damages — including lost revenue, lost data, or business interruption — even if Mirvo has been advised of the possibility of such damages.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            These limitations do not apply to: (a) liability resulting from Mirvo&apos;s intentional misconduct or gross negligence; (b) liability that cannot be excluded under mandatory provisions of French or EU consumer protection law.
          </p>
        </section>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            13. Indemnification
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            You agree to indemnify and hold harmless Mirvo from any claims, losses, or legal fees arising from: (a) your violation of applicable law through your use of the Service; (b) your outbound email campaigns (for which you are the data controller); (c) your breach of these Terms or the Sending Policy; or (d) third-party claims arising from your Content.
          </p>
        </section>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            14. Governing law and disputes
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            These Terms are governed by French law. In the event of a dispute, the parties agree to attempt amicable resolution first. If no resolution is reached within 30 days, the dispute will be submitted to the competent courts of Paris, France.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Nothing in these Terms waives any rights you may have under mandatory consumer protection provisions of your local jurisdiction.
          </p>
        </section>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            15. Miscellaneous
          </h2>
          <ul className="space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            {[
              ['Entire agreement', 'These Terms, together with the Privacy Policy, Cookie Policy, Sending Policy, and DPA, constitute the entire agreement between you and Mirvo regarding the Service.'],
              ['Severability', 'If any provision of these Terms is found invalid or unenforceable, the remaining provisions continue in full force.'],
              ['Waiver', 'Failure to enforce any provision is not a waiver of the right to enforce it later.'],
              ['Assignment', 'You may not assign these Terms without Mirvo\'s written consent. Mirvo may assign them in connection with a merger or acquisition, with 30 days\' notice.'],
              ['Force majeure', 'Neither party is liable for failures caused by events beyond their reasonable control (natural disasters, government actions, infrastructure failures, etc.).'],
              ['Notices', 'Mirvo sends notices to the email address on your account. You are responsible for keeping this address current.'],
              ['Modifications', 'Mirvo will notify you of material changes at least 30 days in advance. Continued use after the effective date constitutes acceptance.'],
            ].map(([term, desc]) => (
              <li key={term as string} className="flex gap-3">
                <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>{term}:</strong> {desc}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            16. Contact
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            For legal and contractual inquiries:{' '}
            <a href="mailto:legal@mirvo.ai" className="transition-opacity hover:opacity-70" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
              legal@mirvo.ai
            </a>
            <br />
            Postal: <span style={{ color: '#1a1a1a' }}>[Mirvo SAS, Address TBD, France]</span>
          </p>
        </section>

      </div>
    </>
  )
}
