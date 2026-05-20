import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { InlineCode } from '@/components/legal/InlineCode'

export const metadata: Metadata = {
  title: 'Privacy Policy — Sentra',
  description: 'How Sentra collects, uses, and protects your personal data.',
  metadataBase: new URL('https://sentra.app'),
  alternates: { canonical: '/legal/privacy' },
}

export default async function PrivacyPage({
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
        {t('privacyTitle')}
      </h1>
      <p className="mb-12" style={{ fontSize: '0.875rem', color: '#666677' }}>
        {t('lastUpdated')}
      </p>

      <div className="space-y-10" style={{ borderTop: '1px solid #e8e3dc', paddingTop: '3rem' }}>

        {/* Introduction */}
        <section>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            This Privacy Policy describes how Sentra (<strong style={{ color: '#1a1a1a' }}>[Sentra SAS — corporate entity to be incorporated, Address TBD, France]</strong>) collects, uses, and protects your personal data when you use the Sentra platform.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Sentra plays two roles under GDPR: we act as <strong style={{ color: '#1a1a1a' }}>data controller</strong> for the personal data of our own users (account holders, subscribers), and as <strong style={{ color: '#1a1a1a' }}>data processor</strong> for the contact data that users import into the platform (prospects, email recipients). For questions about the processing of your prospects&apos; data, see our{' '}
            <Link href="/legal/dpa" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Data Processing Addendum</Link>.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Sentra&apos;s supervisory authority under GDPR is the Commission Nationale de l&apos;Informatique et des Libertés (<strong style={{ color: '#1a1a1a' }}>CNIL</strong>), France.
          </p>
        </section>

        {/* Section 1 */}
        <section id="definitions">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            1. Definitions
          </h2>
          <div className="space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            {[
              ['Personal Data', 'Any information relating to an identified or identifiable natural person.'],
              ['Data Subject', 'The individual whose personal data is being processed.'],
              ['User / Subscriber', 'An individual or organization that has created a Sentra account.'],
              ['Data Controller', 'The entity that determines the purposes and means of processing.'],
              ['Data Processor', 'The entity that processes personal data on behalf of the Data Controller.'],
              ['Processing', 'Any operation performed on personal data (collection, storage, use, transmission, deletion, etc.).'],
              ['Sub-processor', 'A third party engaged by Sentra to process personal data on its behalf.'],
              ['Service', 'The Sentra B2B outbound platform, including all features accessible via sentra.app.'],
            ].map(([term, def]) => (
              <div key={term as string} className="flex gap-3">
                <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>{term}:</strong> {def}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Section 2 */}
        <section id="data-we-collect">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            2. Data we collect about you
          </h2>

          <div className="space-y-5">
            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Account data</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                When you create an account, we collect your email address, name, company name, and professional role. This data is used to create and manage your account and to communicate with you about the Service.
              </p>
            </div>

            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Usage data</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                We collect data about how you use the Service: pages visited, features used, session duration, errors encountered, and in-product interactions. This is used for product improvement and support.
              </p>
            </div>

            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Payment data</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                Payment processing is handled by our payment processor. Sentra does not store or have access to your full card details — we only receive a payment confirmation, subscription status, and billing metadata.
              </p>
            </div>

            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Communications data</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                We retain the content of support messages you send us via email or in-app, as well as automated notifications we send to you, for support and compliance purposes.
              </p>
            </div>

            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Cookie data</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                See our{' '}
                <Link href="/legal/cookies" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Cookie Policy</Link>
                {' '}for full details on what cookies are set and why.
              </p>
            </div>
          </div>
        </section>

        {/* Section 3 */}
        <section id="how-we-use">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            3. How we use your data
          </h2>
          <p className="mb-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            We use your personal data for the following purposes:
          </p>
          <ul className="space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            {[
              ['Provide and operate the Service', 'Creating and managing your account, running campaigns, and delivering core product features.'],
              ['Process payments', 'Managing your subscription, billing, invoicing, and renewal.'],
              ['Communicate with you', 'Sending transactional emails (receipts, alerts, security notices) and service updates. Not marketing — this is operational communication.'],
              ['Improve the product', 'Analyzing aggregate usage patterns to identify friction, prioritize features, and fix bugs. No individual profiling for commercial targeting.'],
              ['Security and fraud prevention', 'Detecting unauthorized access, abuse patterns, and compliance violations.'],
              ['Legal compliance', 'Meeting our obligations under French law, EU law, and contractual requirements.'],
              ['Marketing communications', 'Only if you have explicitly opted in. You can withdraw consent at any time.'],
            ].map(([purpose, detail]) => (
              <li key={purpose as string} className="flex gap-3">
                <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>{purpose}:</strong> {detail}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Section 4 */}
        <section id="legal-basis">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            4. Legal basis for processing
          </h2>
          <p className="mb-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Under GDPR Article 6, we rely on the following legal bases:
          </p>
          <div className="space-y-4">
            {[
              ['Contract performance (Art. 6(1)(b))', 'Providing the Service you subscribed to, managing your account, and processing payments.'],
              ['Legitimate interest (Art. 6(1)(f))', 'Product improvement, security monitoring, and fraud prevention — where our interest does not override your rights and freedoms.'],
              ['Consent (Art. 6(1)(a))', 'Marketing communications and non-essential analytics cookies. You may withdraw consent at any time without affecting the lawfulness of prior processing.'],
              ['Legal obligation (Art. 6(1)(c))', 'Accounting records, tax documentation, and compliance with regulatory requests.'],
            ].map(([basis, desc]) => (
              <div
                key={basis as string}
                className="rounded-lg"
                style={{ backgroundColor: '#ffffff', border: '1px solid #e8e3dc', padding: '0.875rem 1.25rem' }}
              >
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>{basis}</p>
                <p style={{ fontSize: '0.875rem', color: '#4a4a5a', lineHeight: 1.6 }}>{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Section 5 — AI Usage */}
        <section id="ai-usage">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            5. AI usage at Sentra
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Sentra uses AI to help sales teams work more effectively. This section explains exactly how AI is used and what our commitments are.
          </p>

          <div className="mt-6 space-y-5">
            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>What AI is used for</h3>
              <ul className="space-y-2" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                {['Email content generation based on prospect context you provide', 'Sentiment analysis on incoming email replies (to classify response intent)', 'AI-powered help and guidance within the product'].map((item) => (
                  <li key={item} className="flex gap-3">
                    <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Anti-fabrication commitment</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                Sentra&apos;s AI does not invent prospect information beyond what is provided in your imported data. We do not generate fictitious job titles, fictitious company details, or fabricate prospect signals not present in your source data. AI output is grounded in the information you supply.
              </p>
            </div>

            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>No training on customer data</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                Customer data processed through Sentra is not used to train AI models. We work exclusively with enterprise-grade AI providers who provide contractual no-training-on-customer-data guarantees. Your campaigns, prospects, and email content are yours and are not used to improve AI models.
              </p>
            </div>

            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>EU AI Act transparency</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                Sentra qualifies as a Limited Risk AI system under the EU AI Act (Regulation (EU) 2024/1689) and complies with the applicable transparency obligations. Users are informed when they are interacting with AI-generated content or AI-powered features within the product.
              </p>
            </div>

            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Human oversight</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                AI is decision-support, not autonomous. All AI-generated email drafts can be reviewed and edited by you before sending. No email is sent without your explicit action. The final sending decision is always yours.
              </p>
            </div>

            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>AI provider transparency</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                Sentra works with enterprise-grade AI providers under the EU-US Data Privacy Framework (DPF) and Standard Contractual Clauses (SCCs). A full list of AI sub-processors is available in our{' '}
                <Link href="/legal/dpa" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Data Processing Addendum</Link>.
              </p>
            </div>
          </div>
        </section>

        {/* Section 6 */}
        <section id="sharing">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            6. Sharing your data
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            We do not sell your personal data to third parties under any circumstances.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            We share data only with the sub-processors necessary to deliver the Service. These fall into the following categories:
          </p>
          <ul className="mt-4 space-y-2" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            {['Hosting & CDN', 'Database & Authentication', 'Payment processing', 'AI processing', 'Email infrastructure', 'Product analytics'].map((cat) => (
              <li key={cat} className="flex gap-3">
                <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed">{cat}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            A complete list of sub-processors with full names, locations, and data transfer mechanisms (DPF/SCCs) is available in our{' '}
            <Link href="/legal/dpa" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Data Processing Addendum</Link>
            {' '}or by contacting{' '}
            <a href="mailto:privacy@sentra.app" className="transition-opacity hover:opacity-70" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
              privacy@sentra.app
            </a>.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Cross-border transfers to US-based providers are covered by the EU-US Data Privacy Framework (DPF) and Standard Contractual Clauses (SCCs) where applicable.
          </p>
        </section>

        {/* Section 7 */}
        <section id="data-retention">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            7. Data retention
          </h2>
          <p className="mb-5 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            We retain data for as long as necessary for the purpose it was collected, or as required by law.
          </p>
          <div style={{ border: '1px solid #e8e3dc', borderRadius: '8px', overflow: 'hidden', overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse', minWidth: '400px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f5f2ee' }}>
                  <th scope="col" style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#1a1a1a', borderBottom: '1px solid #e8e3dc' }}>Data type</th>
                  <th scope="col" style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#1a1a1a', borderBottom: '1px solid #e8e3dc' }}>Retention period</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Active account data', 'Duration of subscription'],
                  ['Deleted account data', '30-day soft-delete grace period, then hard deletion'],
                  ['Prospect data (imported contacts)', 'Duration of subscription + 30-day grace period after cancellation'],
                  ['Inbox messages', '90 days'],
                  ['Admin action logs', '90 days minimum'],
                  ['Payment records', '10 years (French accounting obligation)'],
                  ['Analytics events', '12 months'],
                  ['Database backups', '7 days rolling'],
                ].map(([type, retention], i) => (
                  <tr key={type as string} style={{ borderBottom: i < 7 ? '1px solid #e8e3dc' : undefined }}>
                    <td style={{ padding: '10px 16px', color: '#1a1a1a' }}>{type}</td>
                    <td style={{ padding: '10px 16px', color: '#4a4a5a' }}>{retention}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 8 */}
        <section id="your-rights">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            8. Your rights
          </h2>
          <p className="mb-5 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Under GDPR, you have the following rights regarding your personal data. To exercise any of them, email{' '}
            <a href="mailto:privacy@sentra.app" className="transition-opacity hover:opacity-70" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
              privacy@sentra.app
            </a>
            . We will respond within 30 days as required by law.
          </p>
          <div className="space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            {[
              ['Right to be informed (Art. 13-14)', 'To know what data we process and why — which is the purpose of this policy.'],
              ['Right of access (Art. 15)', 'To request a copy of the personal data we hold about you.'],
              ['Right to rectification (Art. 16)', 'To correct inaccurate or incomplete personal data.'],
              ['Right to erasure (Art. 17)', 'To request deletion of your data ("right to be forgotten"), subject to legal retention obligations.'],
              ['Right to restriction (Art. 18)', 'To restrict how we use your data while a dispute is being resolved.'],
              ['Right to data portability (Art. 20)', 'To receive your data in a machine-readable format for transfer to another service.'],
              ['Right to object (Art. 21)', 'To object to processing based on legitimate interest or for direct marketing.'],
              ['Automated decision-making (Art. 22)', 'Sentra does not make solely automated decisions with legal or similarly significant effects. AI features are decision-support tools; humans make final decisions.'],
            ].map(([right, desc]) => (
              <div key={right as string} className="flex gap-3">
                <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>{right}:</strong> {desc}</span>
              </div>
            ))}
          </div>
          <p className="mt-5 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            You also have the right to lodge a complaint with the CNIL:{' '}
            <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" className="transition-opacity hover:opacity-70" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
              www.cnil.fr
            </a>.
          </p>
        </section>

        {/* Section 9 */}
        <section id="international-transfers">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            9. International data transfers
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Sentra applies a hybrid data residency approach:
          </p>
          <ul className="mt-4 space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>EU-only:</strong> Your account data and product analytics are stored and processed exclusively in EU data centers (Frankfurt region). No transfer to third countries occurs for these categories.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>US providers under safeguards:</strong> AI processing, email delivery, and payment processing involve US-based providers. Transfers are covered by the EU-US Data Privacy Framework (DPF) and Standard Contractual Clauses (SCCs) under Commission Implementing Decision (EU) 2021/914.</span>
            </li>
          </ul>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Full details including a Transfer Impact Assessment are available in our{' '}
            <Link href="/legal/dpa" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Data Processing Addendum</Link>.
          </p>
        </section>

        {/* Section 10 */}
        <section id="security">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            10. Security
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Sentra implements technical and organizational security measures including TLS 1.3 encryption in transit, AES-256 encryption at rest, Row-Level Security multi-tenant isolation, hardened HTTP security headers, and automated security review on every code change.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            For a complete description of our security measures, see our{' '}
            <Link href="/legal/security" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Security page</Link>.
          </p>
        </section>

        {/* Section 11 */}
        <section id="changes">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            11. Changes to this policy
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            We will notify you of material changes to this Privacy Policy at least 30 days before they take effect, via email and in-app notice. The updated policy will be published at this URL with the version date updated.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Continued use of the Service after a material change takes effect constitutes acceptance of the updated policy. If you do not accept the changes, you may terminate your subscription before the effective date.
          </p>
        </section>

        {/* Section 12 */}
        <section id="contact">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            12. Contact
          </h2>
          <div className="space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            <p className="leading-relaxed">
              Privacy and data protection inquiries:{' '}
              <a href="mailto:privacy@sentra.app" className="transition-opacity hover:opacity-70" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
                privacy@sentra.app
              </a>
            </p>
            <p className="leading-relaxed">
              Postal: <span style={{ color: '#1a1a1a' }}>[Sentra SAS, Address TBD, France]</span>
            </p>
            <p className="leading-relaxed">
              CNIL (supervisory authority):{' '}
              <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" className="transition-opacity hover:opacity-70" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
                www.cnil.fr
              </a>
            </p>
          </div>
        </section>

      </div>
    </>
  )
}
