'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CTAButton } from './CTAButton';

export function LandingHeader() {
  const t = useTranslations('landing.nav');
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-[#faf8f5]/90 backdrop-blur-md border-b border-[#e8e3dc]/80 shadow-sm'
          : 'bg-transparent'
      }`}
    >
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 flex-shrink-0">
            <div className="h-7 w-7 rounded-md bg-[#2563eb] flex items-center justify-center shadow-sm">
              <span className="text-white text-xs font-bold tracking-tight">S</span>
            </div>
            <span className="text-base font-semibold text-[#1a1a1a]">Sentra</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5" aria-label="Main navigation">
            <a
              href="#pricing"
              className="px-3 py-2 text-sm text-[#4a4a5a] hover:text-[#1a1a1a] transition-colors rounded-md hover:bg-[#f5f2ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2"
            >
              {t('pricing')}
            </a>
            <a
              href="#how-it-works"
              className="px-3 py-2 text-sm text-[#4a4a5a] hover:text-[#1a1a1a] transition-colors rounded-md hover:bg-[#f5f2ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2"
            >
              {t('howItWorks')}
            </a>
            <a
              href="#faq"
              className="px-3 py-2 text-sm text-[#4a4a5a] hover:text-[#1a1a1a] transition-colors rounded-md hover:bg-[#f5f2ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2"
            >
              {t('faq')}
            </a>
          </nav>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm text-[#4a4a5a] hover:text-[#1a1a1a] transition-colors px-3 py-2 rounded-md hover:bg-[#f5f2ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2"
            >
              {t('signIn')}
            </Link>
            <CTAButton href="/signup" variant="primary" className="px-4 py-2 text-sm">
              {t('startTrial')}
            </CTAButton>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 rounded-md text-[#4a4a5a] hover:bg-[#f5f2ee] transition-colors"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={t('menuLabel')}
            aria-expanded={mobileOpen}
          >
            <div className="space-y-1.5">
              <span className={`block h-0.5 w-5 bg-current transition-all ${mobileOpen ? 'rotate-45 translate-y-2' : ''}`} />
              <span className={`block h-0.5 w-5 bg-current transition-all ${mobileOpen ? 'opacity-0' : ''}`} />
              <span className={`block h-0.5 w-5 bg-current transition-all ${mobileOpen ? '-rotate-45 -translate-y-2' : ''}`} />
            </div>
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-[#e8e3dc] py-4 space-y-1 bg-[#faf8f5]">
            <a href="#pricing" className="block px-3 py-2 text-sm text-[#4a4a5a] hover:text-[#1a1a1a] hover:bg-[#f5f2ee] rounded-md">
              {t('pricing')}
            </a>
            <a href="#how-it-works" className="block px-3 py-2 text-sm text-[#4a4a5a] hover:text-[#1a1a1a] hover:bg-[#f5f2ee] rounded-md">
              {t('howItWorks')}
            </a>
            <a href="#faq" className="block px-3 py-2 text-sm text-[#4a4a5a] hover:text-[#1a1a1a] hover:bg-[#f5f2ee] rounded-md">
              {t('faq')}
            </a>
            <div className="pt-3 flex flex-col gap-2 border-t border-[#e8e3dc] mt-2">
              <Link href="/login" className="block text-center text-sm text-[#4a4a5a] py-2 hover:text-[#1a1a1a]">
                {t('signIn')}
              </Link>
              <CTAButton href="/signup" variant="primary" className="w-full justify-center">
                {t('startTrial')}
              </CTAButton>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
