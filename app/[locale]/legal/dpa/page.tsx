import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { InlineCode } from '@/components/legal/InlineCode'

export const metadata: Metadata = {
  title: 'Data Processing Addendum — Sentra',
  description: 'Sentra Data Processing Addendum (DPA): sub-processors, GDPR compliance, SCCs, and data protection obligations.',
  metadataBase: new URL('https://sentra.app'),
  alternates: { canonical: '/legal/dpa' },
}

export default async function DpaPage({
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
        {t('dpaTitle')}
      </h1>
      <p className="mb-4" style={{ fontSize: '0.875rem', color: '#666677' }}>
        {t('lastUpdated')}
      </p>

      <div
        className="mb-10 rounded-lg"
        style={{ backgroundColor: '#f0ede8', border: '1px solid #e8e3dc', padding: '1rem 1.25rem' }}
      >
        <p style={{ fontSize: '0.875rem', color: '#4a4a5a', lineHeight: 1.6 }}>
          {t('dpaNonNegotiable')}
        </p>
      </div>

      <div className="space-y-10" style={{ borderTop: '1px solid #e8e3dc', paddingTop: '3rem' }}>

        <section id="preamble">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            Preamble
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            This Data Processing Addendum (&ldquo;DPA&rdquo;) forms part of the Terms of Service between the User (&ldquo;Data Controller&rdquo;) and Sentra (<strong style={{ color: '#1a1a1a' }}>[Sentra SAS — corporate entity to be incorporated, Address TBD, France]</strong>) (&ldquo;Data Processor&rdquo;).
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            This DPA applies when the User is established in the EU/EEA, UK, or Switzerland, or when they process personal data of data subjects in those territories — which is the case for any User conducting GDPR-regulated outbound campaigns.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            By agreeing to the{' '}
            <Link href="/legal/terms" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Terms of Service</Link>
            , you also agree to this DPA where applicable.
          </p>
        </section>

        <section id="definitions">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            1. Definitions
          </h2>
          <div className="space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            {[
              ['Data Controller', 'The entity (User/Subscriber) that determines the purposes and means of processing personal data.'],
              ['Data Processor', 'Sentra, processing personal data on behalf of the Data Controller.'],
              ['Sub-processor', 'A third party engaged by Sentra to process personal data in connection with the Service.'],
              ['Personal Data Breach', 'A breach of security leading to accidental or unlawful destruction, loss, alteration, or unauthorized disclosure of or access to personal data.'],
              ['SCCs', 'Standard Contractual Clauses approved by Commission Implementing Decision (EU) 2021/914 of 4 June 2021.'],
              ['DPF', 'EU-US Data Privacy Framework, recognized as adequate under GDPR for transfers to participating US organizations.'],
            ].map(([term, def]) => (
              <div key={term as string} className="flex gap-3">
                <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>{term}:</strong> {def}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="roles">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            2. Roles and responsibilities
          </h2>
          <ul className="space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>User = Data Controller</strong> for the prospect contact data imported into Sentra. The User determines who to contact, for what purpose, and is responsible for having a valid legal basis (e.g., legitimate interest for B2B outbound).</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>Sentra = Data Processor</strong> for that contact data. Sentra processes it only to deliver the Service — email generation, campaign management, deliverability monitoring — and for no other purpose.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>Sentra = Data Controller</strong> for subscriber account data (name, email, billing information) — governed by the{' '}
                <Link href="/legal/privacy" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Privacy Policy</Link>.
              </span>
            </li>
          </ul>
        </section>

        <section id="processing">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            3. Processing description
          </h2>
          <p className="mb-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            In accordance with GDPR Article 28(3), the following describes the processing carried out by Sentra on behalf of the User:
          </p>
          <div className="space-y-4">
            {[
              ['Subject matter', 'Provision of B2B outbound email infrastructure and AI-assisted campaign tooling.'],
              ['Duration', 'The Subscription period plus applicable retention periods as defined in the Privacy Policy.'],
              ['Nature of processing', 'Storage, retrieval, transmission, AI-assisted email draft generation, reply sentiment analysis, and deliverability monitoring.'],
              ['Categories of data subjects', 'B2B professionals imported by the User as prospects (decision-makers, potential buyers, business contacts).'],
              ['Categories of personal data', 'Business contact data (email address, name, job title, company name, LinkedIn URL), behavioral signals (email opens, clicks, reply detection), and email content (sent and received campaign emails).'],
            ].map(([label, desc]) => (
              <div
                key={label as string}
                className="rounded-lg"
                style={{ backgroundColor: '#ffffff', border: '1px solid #e8e3dc', padding: '0.875rem 1.25rem' }}
              >
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>{label}</p>
                <p style={{ fontSize: '0.875rem', color: '#4a4a5a', lineHeight: 1.6 }}>{desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="sub-processors">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            4. Sub-processors
          </h2>
          <p className="mb-5 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Sentra engages the following sub-processors to deliver the Service. By agreeing to these Terms, you grant general authorization for Sentra to engage sub-processors, subject to the notification obligations below.
          </p>

          <div style={{ border: '1px solid #e8e3dc', borderRadius: '8px', overflow: 'hidden', overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse', minWidth: '600px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f5f2ee' }}>
                  <th scope="col" style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#1a1a1a', borderBottom: '1px solid #e8e3dc' }}>Sub-processor</th>
                  <th scope="col" style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#1a1a1a', borderBottom: '1px solid #e8e3dc' }}>Service description</th>
                  <th scope="col" style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#1a1a1a', borderBottom: '1px solid #e8e3dc' }}>Location</th>
                  <th scope="col" style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#1a1a1a', borderBottom: '1px solid #e8e3dc' }}>Transfer mechanism</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Vercel Inc.', 'Hosting, frontend serving, CDN', 'USA (EU edge available)', 'EU-US DPF + SCCs'],
                  ['Supabase Inc.', 'Database (Postgres), authentication, storage', 'EU (Frankfurt)', 'N/A — EU-resident'],
                  ['Stripe Inc.', 'Payment processing', 'USA', 'EU-US DPF + SCCs'],
                  ['Resend Inc.', 'Transactional email delivery', 'USA', 'EU-US DPF + SCCs'],
                  ['Anthropic PBC', 'AI-powered email generation, sentiment analysis', 'USA', 'EU-US DPF + SCCs'],
                  ['Instantly.ai (Foo Monk LLC)', 'Outbound email infrastructure', 'USA', 'EU-US DPF + SCCs'],
                  ['Clay Labs Inc.', 'Prospect data enrichment', 'USA', 'EU-US DPF + SCCs'],
                  ['PostHog Inc.', 'Product analytics, session replay (EU project)', 'EU (Frankfurt)', 'N/A — EU-resident'],
                ].map(([vendor, service, location, mechanism], i) => (
                  <tr key={vendor as string} style={{ borderBottom: i < 7 ? '1px solid #e8e3dc' : undefined }}>
                    <td style={{ padding: '10px 14px', color: '#1a1a1a', fontWeight: 500 }}>{vendor}</td>
                    <td style={{ padding: '10px 14px', color: '#4a4a5a' }}>{service}</td>
                    <td style={{ padding: '10px 14px', color: '#4a4a5a' }}>{location}</td>
                    <td style={{ padding: '10px 14px', color: '#4a4a5a' }}>{mechanism}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            <p className="leading-relaxed">
              Sentra will notify Users by email at least <strong style={{ color: '#1a1a1a' }}>30 days</strong> before adding a new sub-processor. Users may object within that period. If the objection cannot be resolved, the User may terminate the Subscription with a pro-rata refund of unused portions.
            </p>
            <p className="leading-relaxed">
              Sentra remains liable for the acts and omissions of all sub-processors as if they were Sentra&apos;s own.
            </p>
          </div>
        </section>

        <section id="security-measures">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            5. Security measures
          </h2>
          <p className="mb-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Sentra implements the following technical and organizational security measures in accordance with GDPR Article 32:
          </p>
          <ul className="space-y-2" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            {[
              'Encryption in transit using TLS 1.3; encryption at rest using AES-256',
              'Row-Level Security (RLS) enforced at the database level for complete multi-tenant isolation',
              'Hardened HTTP security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy)',
              'Automated security review integrated into the development pipeline (per-PR)',
              'Access controls with role-based permissions; admin access requires separate authentication',
              'Audit logging for administrative actions',
            ].map((item) => (
              <li key={item} className="flex gap-3">
                <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
                <span className="leading-relaxed" style={{ fontSize: '0.9rem' }}>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            A full description is available on our{' '}
            <Link href="/legal/security" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Security page</Link>.
          </p>
        </section>

        <section id="data-subject-rights">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            6. Data subject rights assistance
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Sentra will assist the User in responding to data subject requests (access, erasure, portability, objection) insofar as the relevant data is within Sentra&apos;s systems and technically accessible.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            The User, as Data Controller, is responsible for verifying the identity of the requesting data subject and for assessing the legitimacy of each request before acting on it.
          </p>
        </section>

        <section id="breach-notification">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            7. Personal data breach notification
          </h2>
          <ul className="space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed">Sentra will notify the affected User within <strong style={{ color: '#1a1a1a' }}>48 hours</strong> of becoming aware of a Personal Data Breach involving that User&apos;s data.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed">The notification will include: the nature of the breach, the categories and approximate number of affected data subjects, the likely consequences, and the measures taken or proposed to address the breach.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed">The User retains the obligation to notify the relevant supervisory authority (e.g., CNIL) within 72 hours of becoming aware of a notifiable breach, per GDPR Article 33.</span>
            </li>
          </ul>
        </section>

        <section id="international-transfers">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            8. International transfers
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            For transfers of personal data from the EU/EEA/UK to third countries (primarily the USA), Sentra applies Standard Contractual Clauses approved by Commission Implementing Decision (EU) 2021/914, Module 2 (Controller to Processor), as the primary transfer mechanism.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            The full text of the SCCs is available at:{' '}
            <a
              href="https://eur-lex.europa.eu/eli/dec_impl/2021/914"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-opacity hover:opacity-70"
              style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}
            >
              <InlineCode>eur-lex.europa.eu/eli/dec_impl/2021/914</InlineCode>
            </a>
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            For sub-processors participating in the EU-US Data Privacy Framework (DPF), transfers to those sub-processors rely on the DPF adequacy decision in addition to SCCs. Sentra conducts Transfer Impact Assessments for all US-based sub-processors and applies supplementary measures including data minimization, contractual safeguards, and access logging.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Sub-processors located in the EU (Supabase — Frankfurt; PostHog — EU project) do not involve cross-border transfers of personal data.
          </p>
        </section>

        <section id="audit-rights">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            9. Audit rights
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Sentra makes available the information necessary to demonstrate compliance with GDPR Article 28, including this DPA, relevant certifications, and security documentation.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Users may request an information-based audit no more than once per calendar year (unless mandated by a regulatory authority). Requests require 30 days&apos; advance notice and are subject to confidentiality obligations. Sentra may decline on-site audits and instead provide documented evidence of compliance.
          </p>
        </section>

        <section id="termination">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            10. Termination of DPA
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            This DPA remains in effect for the duration of the Subscription. Upon termination of the Subscription, Sentra will, at the User&apos;s election, either return or permanently delete all User personal data within 30 days — unless retention is required by applicable law.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Database backups containing User data will be purged within 7 days following the standard backup rotation schedule. Payment records may be retained for up to 10 years as required by French accounting law.
          </p>
        </section>

        <section id="contact">
          <h2 className="mb-4 tracking-tight" style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}>
            11. Contact
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            DPA-related inquiries:{' '}
            <a href="mailto:privacy@sentra.app" className="transition-opacity hover:opacity-70" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
              privacy@sentra.app
            </a>
            <br />
            Postal: <span style={{ color: '#1a1a1a' }}>[Sentra SAS, Address TBD, France]</span>
          </p>
        </section>

      </div>
    </>
  )
}
