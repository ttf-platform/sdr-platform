import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { InlineCode } from '@/components/legal/InlineCode'

export const metadata: Metadata = {
  title: 'Cookie Policy — Mirvo',
  description: 'How Mirvo uses cookies and how to manage them.',
  metadataBase: new URL('https://mirvo.ai'),
  alternates: { canonical: '/legal/cookies' },
}

export default async function CookiesPage({
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
        {t('cookiesTitle')}
      </h1>
      <p className="mb-12" style={{ fontSize: '0.875rem', color: '#666677' }}>
        {t('lastUpdated')}
      </p>

      <div className="space-y-10" style={{ borderTop: '1px solid #e8e3dc', paddingTop: '3rem' }}>

        <section>
          <h2
            className="mb-4 tracking-tight"
            style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
          >
            What are cookies?
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Cookies are small text files stored on your device by your browser when you visit a website. They help websites remember your preferences, keep you logged in, and understand how the product is being used. Mirvo uses cookies sparingly — only what is necessary to operate the service and improve it.
          </p>
        </section>

        <section>
          <p className="mb-10 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Mirvo uses three categories of cookies. We do not use advertising cookies or data broker integrations — no ad networks, no retargeting pixels.
          </p>
        </section>

        <section>
          <h2
            className="mb-4 tracking-tight"
            style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
          >
            Essential cookies
            <span
              className="ml-3 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ backgroundColor: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', verticalAlign: 'middle' }}
            >
              No consent required
            </span>
          </h2>
          <p className="mb-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            These cookies are strictly necessary for the service to function. You cannot opt out of them without losing access to Mirvo.
          </p>
          <div style={{ border: '1px solid #e8e3dc', borderRadius: '8px', overflow: 'hidden', overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse', minWidth: '440px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f5f2ee' }}>
                  <th scope="col" style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#1a1a1a', borderBottom: '1px solid #e8e3dc' }}>Cookie</th>
                  <th scope="col" style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#1a1a1a', borderBottom: '1px solid #e8e3dc' }}>Purpose</th>
                  <th scope="col" style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#1a1a1a', borderBottom: '1px solid #e8e3dc' }}>Expires</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid #e8e3dc' }}>
                  <td style={{ padding: '10px 16px', color: '#1a1a1a' }}><InlineCode>sb-*-auth-token</InlineCode></td>
                  <td style={{ padding: '10px 16px', color: '#4a4a5a' }}>Authentication session (keeps you logged in)</td>
                  <td style={{ padding: '10px 16px', color: '#4a4a5a' }}>Session / 7 days</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #e8e3dc' }}>
                  <td style={{ padding: '10px 16px', color: '#1a1a1a' }}><InlineCode>__Host-next-auth.csrf-token</InlineCode></td>
                  <td style={{ padding: '10px 16px', color: '#4a4a5a' }}>CSRF protection on form submissions</td>
                  <td style={{ padding: '10px 16px', color: '#4a4a5a' }}>Session</td>
                </tr>
                <tr>
                  <td style={{ padding: '10px 16px', color: '#1a1a1a' }}><InlineCode>__stripe_mid / __stripe_sid</InlineCode></td>
                  <td style={{ padding: '10px 16px', color: '#4a4a5a' }}>Stripe fraud prevention (checkout flow only)</td>
                  <td style={{ padding: '10px 16px', color: '#4a4a5a' }}>1 year / Session</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2
            className="mb-4 tracking-tight"
            style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
          >
            Analytics cookies
            <span
              className="ml-3 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ backgroundColor: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', verticalAlign: 'middle' }}
            >
              Consent required in EU
            </span>
          </h2>
          <p className="mb-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Analytics session cookies (EU-resident product analytics provider) — used for product usage analysis and session replay. Data is stored within the EU (Frankfurt region) and never transferred outside Europe.
          </p>
          <div style={{ border: '1px solid #e8e3dc', borderRadius: '8px', overflow: 'hidden', overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse', minWidth: '440px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f5f2ee' }}>
                  <th scope="col" style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#1a1a1a', borderBottom: '1px solid #e8e3dc' }}>Cookie</th>
                  <th scope="col" style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#1a1a1a', borderBottom: '1px solid #e8e3dc' }}>Purpose</th>
                  <th scope="col" style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#1a1a1a', borderBottom: '1px solid #e8e3dc' }}>Expires</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid #e8e3dc' }}>
                  <td style={{ padding: '10px 16px', color: '#1a1a1a' }}><InlineCode>ph_*</InlineCode></td>
                  <td style={{ padding: '10px 16px', color: '#4a4a5a' }}>Product analytics, session replay (EU-only)</td>
                  <td style={{ padding: '10px 16px', color: '#4a4a5a' }}>1 year</td>
                </tr>
                <tr>
                  <td style={{ padding: '10px 16px', color: '#1a1a1a' }}><InlineCode>ph_*_window_id</InlineCode></td>
                  <td style={{ padding: '10px 16px', color: '#4a4a5a' }}>Session window tracking</td>
                  <td style={{ padding: '10px 16px', color: '#4a4a5a' }}>Session</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2
            className="mb-4 tracking-tight"
            style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
          >
            Marketing cookies
            <span
              className="ml-3 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ backgroundColor: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0', verticalAlign: 'middle' }}
            >
              Not used
            </span>
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Mirvo does not use advertising cookies, retargeting pixels, or third-party marketing trackers. No data is shared with ad networks.
          </p>
        </section>

        <section>
          <h2
            className="mb-4 tracking-tight"
            style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
          >
            Managing cookies
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            You can clear or block cookies from your browser settings at any time. Note that clearing authentication cookies will log you out of Mirvo. Most modern browsers allow you to block third-party cookies by default without affecting first-party session cookies.
          </p>
          <p className="mt-4 leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            To opt out of analytics cookies, you can use a browser extension that blocks analytics scripts (e.g., uBlock Origin). A dedicated cookie preferences panel will be added in a future update.
          </p>
        </section>

        <section>
          <h2
            className="mb-4 tracking-tight"
            style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
          >
            Third-party cookies
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Stripe sets cookies on <InlineCode>checkout.stripe.com</InlineCode> during the payment flow for fraud prevention purposes. These are scoped to Stripe&apos;s domain and governed by{' '}
            <a
              href="https://stripe.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-opacity hover:opacity-70"
              style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}
            >
              Stripe&apos;s privacy policy
            </a>
            . No other third-party cookies are set by Mirvo.
          </p>
        </section>

        <section>
          <h2
            className="mb-4 tracking-tight"
            style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
          >
            Changes to this policy
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            We will update this policy if we add new cookies or change how existing ones work. Material changes will be communicated via in-app notice or email before they take effect.
          </p>
        </section>

        <section>
          <h2
            className="mb-4 tracking-tight"
            style={{ fontSize: '1.375rem', fontWeight: 500, color: '#1a1a1a' }}
          >
            Questions?
          </h2>
          <p className="leading-relaxed" style={{ color: '#4a4a5a', maxWidth: '60ch' }}>
            Email us at{' '}
            <a
              href="mailto:privacy@mirvo.ai"
              className="transition-opacity hover:opacity-70"
              style={{ color: '#1a1a1a', textDecoration: 'underline', textUnderlineOffset: '3px' }}
            >
              privacy@mirvo.ai
            </a>
            .
          </p>
        </section>

      </div>
    </>
  )
}
