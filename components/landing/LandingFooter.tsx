import Link from 'next/link';

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <p
        className="mb-4 uppercase text-white"
        style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.14em' }}
      >
        {heading}
      </p>
      <ul className="space-y-3">
        {links.map(({ label, href }) => (
          <li key={label}>
            <Link
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              href={href as any}
              className="text-[#888888] hover:text-[#c0c0c0] transition-colors"
              style={{ fontSize: '0.875rem', fontWeight: 300 }}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LandingFooter() {
  return (
    <footer style={{ backgroundColor: '#1a1a1a' }}>
      <div
        className="mx-auto max-w-6xl px-6 lg:px-8 py-16 lg:py-20"
        style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4 lg:gap-12">

          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <span
                className="flex items-center justify-center rounded"
                style={{
                  width: 28,
                  height: 28,
                  backgroundColor: '#2563eb',
                  fontSize: '0.8125rem',
                  fontWeight: 700,
                  color: '#ffffff',
                  letterSpacing: '-0.01em',
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                S
              </span>
              <span
                className="text-white"
                style={{ fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.01em' }}
              >
                Sentra
              </span>
            </div>
            <p
              className="text-[#888888]"
              style={{ fontSize: '0.875rem', fontWeight: 300, lineHeight: 1.55, maxWidth: '18rem' }}
            >
              AI-powered outbound for founders who sell before they hire.
            </p>

            {/* Status */}
            <div className="mt-6 flex items-center gap-2">
              <span
                className="motion-safe:animate-pulse rounded-full"
                style={{ width: 7, height: 7, backgroundColor: '#22c55e', flexShrink: 0 }}
                aria-hidden="true"
              />
              <span style={{ fontSize: '0.8125rem', fontWeight: 300, color: '#888888' }}>
                All systems operational
              </span>
            </div>
          </div>

          {/* Product */}
          <FooterColumn
            heading="Product"
            links={[
              { label: 'Features', href: '/#features' },
              { label: 'Pricing', href: '/#pricing' },
              { label: 'Roadmap', href: '/#roadmap' },
              { label: 'Changelog', href: '/changelog' },
            ]}
          />

          {/* Company */}
          <FooterColumn
            heading="Company"
            links={[
              { label: 'About', href: '/about' },
              { label: 'Blog', href: '/blog' },
              { label: 'Careers', href: '/careers' },
              { label: 'Contact', href: 'mailto:hello@sentra.so' },
            ]}
          />

          {/* Legal */}
          <FooterColumn
            heading="Legal"
            links={[
              { label: 'Privacy Policy', href: '/legal/privacy' },
              { label: 'Terms of Service', href: '/legal/terms' },
              { label: 'Cookie Policy', href: '/legal/cookies' },
              { label: 'GDPR', href: '/legal/gdpr' },
            ]}
          />
        </div>

        {/* Bottom bar */}
        <div
          className="mt-12 pt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <p style={{ fontSize: '0.8125rem', fontWeight: 300, color: '#888888' }}>
            &copy; 2026 Sentra. All rights reserved.
          </p>
          <p style={{ fontSize: '0.8125rem', fontWeight: 300, color: '#888888' }}>
            Built for founders who move fast.
          </p>
        </div>
      </div>
    </footer>
  );
}
