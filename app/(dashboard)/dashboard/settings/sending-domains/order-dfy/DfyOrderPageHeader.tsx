'use client';

/**
 * Client wrapper for the DFY order page header — extracted so we can call
 * useTranslations() from inside the NextIntlClientProvider tree wired by the
 * dashboard layout. The page itself stays a Server Component for the auth
 * guard + metadata.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';

export function DfyOrderPageHeader() {
  const t = useTranslations('dashboard.sendingDomains.dfyWizard');
  return (
    <header className="mb-6">
      <Link
        href="/dashboard/settings/sending-domains"
        className="mb-3 inline-flex items-center gap-1 text-xs text-[#4a4a5a] hover:text-[#1a1a1a]"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M7 2L3 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t('common.backToSendingDomains')}
      </Link>
      <h1 className="text-xl font-semibold text-[#1a1a1a]">{t('page.heading')}</h1>
      <p className="mt-1 text-sm text-[#4a4a5a]">{t('page.subheading')}</p>
    </header>
  );
}
