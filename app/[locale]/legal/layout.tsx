'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Link } from '@/i18n/routing'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { LandingFooter } from '@/components/landing/LandingFooter'

const legalLinks = [
  { href: '/legal/privacy', label: 'Privacy Policy' },
  { href: '/legal/terms', label: 'Terms of Service' },
  { href: '/legal/cookies', label: 'Cookie Policy' },
  { href: '/legal/security', label: 'Security' },
  { href: '/legal/sending-policy', label: 'Sending Policy' },
  { href: '/legal/dpa', label: 'Data Processing Addendum' },
]

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#faf8f5' }}>
      <LandingHeader />

      <main className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        {/* Breadcrumb */}
        <nav className="mb-10" aria-label="Breadcrumb">
          <ol className="flex items-center gap-2" style={{ fontSize: '0.8125rem', color: '#666677' }}>
            <li>
              <Link
                href="/#footer"
                className="transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2 rounded"
                style={{ color: '#666677', textDecoration: 'underline', textUnderlineOffset: '3px' }}
              >
                Home
              </Link>
            </li>
            <li aria-hidden="true" style={{ color: '#cccccc' }}>›</li>
            <li style={{ color: '#1a1a1a', fontWeight: 500 }}>Legal</li>
          </ol>
        </nav>

        <div className="flex flex-col md:flex-row gap-12 items-start">
          {/* Sidebar — desktop */}
          <aside className="hidden md:block shrink-0 sticky self-start" style={{ width: '200px', top: '6rem' }}>
            <div>
              <p
                className="mb-4 uppercase"
                style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.14em', color: '#aaaaaa' }}
              >
                Legal
              </p>
              <nav aria-label="Legal pages">
                <ul className="space-y-1">
                  {legalLinks.map(({ href, label }) => {
                    const active = pathname === href
                    return (
                      <li key={href}>
                        <Link
                          href={href as never}
                          className="flex items-center min-h-[44px] py-1.5 px-1 text-sm transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2"
                          style={{
                            color: active ? '#1a1a1a' : '#6a6a7a',
                            fontWeight: active ? 600 : 400,
                            textDecoration: 'none',
                            paddingLeft: active ? '0.625rem' : '0',
                            borderLeft: active ? '2px solid #3b6bef' : '2px solid transparent',
                            transition: 'color 0.15s ease, padding-left 0.15s ease, border-color 0.15s ease',
                          }}
                        >
                          {label}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </nav>
            </div>
          </aside>

          {/* Mobile dropdown */}
          <div className="md:hidden w-full mb-8">
            <label
              htmlFor="legal-nav-mobile"
              className="block mb-2"
              style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#4a4a5a' }}
            >
              Legal pages
            </label>
            <select
              id="legal-nav-mobile"
              className="w-full text-sm rounded-lg"
              style={{
                border: '1px solid #e8e3dc',
                padding: '8px 12px',
                backgroundColor: '#ffffff',
                color: '#1a1a1a',
                appearance: 'auto',
              }}
              value={pathname}
              onChange={(e) => router.push(e.target.value as never)}
            >
              {legalLinks.map(({ href, label }) => (
                <option key={href} value={href}>{label}</option>
              ))}
            </select>
          </div>

          {/* Article content */}
          <article className="min-w-0 flex-1" style={{ maxWidth: '672px' }}>
            {children}
          </article>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
