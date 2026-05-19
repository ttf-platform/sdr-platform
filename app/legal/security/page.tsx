import type { Metadata } from 'next'
import { InlineCode } from '@/components/legal/InlineCode'

export const metadata: Metadata = {
  title: 'Security — Sentra',
  description: 'How Sentra protects your data: encryption, access controls, infrastructure, and incident response.',
  metadataBase: new URL('https://sentra.app'),
  alternates: { canonical: '/legal/security' },
}

export default function SecurityPage() {
  return (
    <>
      <p
        className="mb-4 uppercase"
        style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: '#666677' }}
      >
        Legal
      </p>
      <h1
        className="mb-3 tracking-tight"
        style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 500, color: '#1a1a1a', lineHeight: 1.15 }}
      >
        Security at Sentra
      </h1>
      <p className="mb-12" style={{ fontSize: '0.875rem', color: '#666677' }}>
        Last updated: May 19, 2026 · Version 1.0
      </p>

      <div className="space-y-10" style={{ borderTop: '1px solid #e8e3dc', paddingTop: '3rem' }}>

        <section>
          <h2
            className="mb-4 tracking-tight"
            style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
          >
            Our commitment
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Sentra is built for sales teams that handle sensitive business contact data. We take that responsibility seriously. This page describes the technical and organizational measures we have in place to protect your data. We aim to be transparent about what we do — and what we don&apos;t yet have in place.
          </p>
        </section>

        <section>
          <h2
            className="mb-4 tracking-tight"
            style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
          >
            Technical measures
          </h2>

          <div className="space-y-6">
            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Data encryption</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                All data in transit is encrypted using TLS 1.3. Data at rest is encrypted using AES-256 at the storage layer by default.
              </p>
            </div>

            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Access controls &amp; multi-tenant isolation</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                Row-Level Security (RLS) is enforced at the database level on all tables. Each workspace&apos;s data is isolated — a user in workspace A cannot access data from workspace B, regardless of application-level logic. This isolation is validated through automated integration tests that run against real data on every pull request.
              </p>
            </div>

            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Authentication</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                Authentication is handled by a managed auth provider using industry-standard session management. Sessions are scoped and expire automatically. Admin access to internal tooling uses a separate, hardened authentication path.
              </p>
            </div>

            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Security headers</h3>
              <p className="mb-2 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                Every Sentra response includes a hardened set of HTTP security headers:
              </p>
              <ul className="space-y-1" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.875rem' }}>
                {[
                  'Content-Security-Policy (CSP) — restricts script and resource origins',
                  'HTTP Strict Transport Security (HSTS)',
                  'X-Frame-Options: DENY — prevents clickjacking',
                  'X-Content-Type-Options: nosniff',
                  'Referrer-Policy: strict-origin-when-cross-origin',
                  'Permissions-Policy — disables unused browser APIs',
                ].map((item) => (
                  <li key={item} className="flex gap-3">
                    <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="mb-2" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#1a1a1a' }}>Code review &amp; dependency scanning</h3>
              <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch', fontSize: '0.9rem' }}>
                Every pull request is automatically reviewed by an AI-powered security analysis tool before merge. Dependencies are regularly audited for known CVEs, and critical vulnerabilities trigger immediate patching.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2
            className="mb-4 tracking-tight"
            style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
          >
            Infrastructure providers
          </h2>
          <p className="mb-6 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Sentra is built on a carefully selected set of infrastructure providers. We describe them by category here. A complete list with names, locations, and data transfer frameworks (DPF/SCCs) is available in our{' '}
            <a href="/legal/dpa" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Data Processing Addendum</a>
            {' '}or by contacting{' '}
            <a href="mailto:privacy@sentra.app" className="transition-opacity hover:opacity-70" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
              privacy@sentra.app
            </a>.
          </p>

          <div className="space-y-4">
            {[
              { category: 'Hosting & CDN', description: 'Leading cloud provider with EU region capability and global edge delivery network.' },
              { category: 'Database & Authentication', description: 'Managed Postgres provider with EU region. Handles data storage and user authentication.' },
              { category: 'Payment processing', description: 'PCI-DSS Level 1 certified payment processor. Covered by the EU-US Data Privacy Framework (DPF) and Standard Contractual Clauses (SCCs).' },
              { category: 'AI processing', description: 'Enterprise-grade LLM provider covered by DPF + SCCs. Does not train on customer data. See Privacy Policy for full details.' },
              { category: 'Email infrastructure', description: 'DPF-certified providers for transactional email (notifications, billing) and outbound email delivery (campaigns).' },
              { category: 'Product analytics', description: 'EU-resident analytics platform. All data stays in the EU (Frankfurt). No advertising profiles, no data transfers outside EU.' },
            ].map(({ category, description }) => (
              <div
                key={category}
                className="rounded-lg"
                style={{ backgroundColor: '#ffffff', border: '1px solid #e8e3dc', padding: '1rem 1.25rem' }}
              >
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>{category}</p>
                <p style={{ fontSize: '0.875rem', color: '#4a4a5a', lineHeight: 1.6 }}>{description}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2
            className="mb-4 tracking-tight"
            style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
          >
            Data residency
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Sentra follows a hybrid data residency model:
          </p>
          <ul className="mt-4 space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>EU-only:</strong> User account data, workspace data, and product analytics are stored and processed exclusively in EU data centers (Frankfurt region). No transfer outside the EU occurs for these categories.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed"><strong style={{ color: '#1a1a1a' }}>US providers with safeguards:</strong> AI processing and email delivery involve US-based providers. Both operate under the EU-US Data Privacy Framework (DPF) and Standard Contractual Clauses (SCCs), which are the recognized legal mechanisms for cross-border transfers under GDPR.</span>
            </li>
          </ul>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            We chose this approach to balance EU data residency for the most sensitive categories with access to best-in-class providers for AI and email, where EU-based alternatives do not yet meet our reliability requirements.
          </p>
        </section>

        <section>
          <h2
            className="mb-4 tracking-tight"
            style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
          >
            Incident response
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            In the event of a security incident affecting personal data, Sentra follows a structured response process:
          </p>
          <ul className="mt-4 space-y-3" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed">We notify the French data protection authority (CNIL) within 72 hours of becoming aware of a breach affecting EU users, as required by GDPR Article 33.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed">Affected users are notified directly without undue delay when the breach is likely to result in a high risk to their rights and freedoms.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>—</span>
              <span className="leading-relaxed">A post-mortem describing the incident, its scope, and remediation steps will be published at <InlineCode>status.sentra.app</InlineCode> (coming soon) for material incidents.</span>
            </li>
          </ul>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            To report a suspected security issue, email{' '}
            <a href="mailto:security@sentra.app" className="transition-opacity hover:opacity-70" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
              security@sentra.app
            </a>
            . We treat all security reports seriously and aim to respond within 24 hours.
          </p>
        </section>

        <section>
          <h2
            className="mb-4 tracking-tight"
            style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
          >
            Roadmap
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Sentra is committed to obtaining SOC 2 Type II certification as we scale. We have not yet set a public timeline for this. We will update this page when certification milestones are reached.
          </p>
        </section>

        <section>
          <h2
            className="mb-4 tracking-tight"
            style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
          >
            Contact
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Security questions:{' '}
            <a href="mailto:security@sentra.app" className="transition-opacity hover:opacity-70" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
              security@sentra.app
            </a>
            <br />
            Privacy and data questions:{' '}
            <a href="mailto:privacy@sentra.app" className="transition-opacity hover:opacity-70" style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
              privacy@sentra.app
            </a>
          </p>
        </section>

      </div>
    </>
  )
}
