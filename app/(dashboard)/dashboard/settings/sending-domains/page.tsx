/**
 * /app/dashboard/settings/sending-domains/page.tsx
 *
 * Server Component: fetches the user's email accounts on initial load and
 * hands them to the Client wrapper for interactivity. RLS scopes the query
 * to the user's workspace automatically.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SendingDomainsClient } from './_components/SendingDomainsClient';
import type { EmailAccount } from './_components/SendingDomainCard';

export const metadata = {
  title: 'Sending domains · Mirvo',
};

export default async function SendingDomainsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  const { data: accounts, error } = await supabase
    .from('email_accounts')
    .select(
      'id, domain, email_address, sender_name, warmup_status, reputation_score, ' +
      'daily_capacity, daily_sent, dns_spf_verified, dns_dkim_verified, ' +
      'dns_dmarc_verified, sending_phase, paused_by_user, setup_status'
    )
    .order('created_at', { ascending: false })
    .returns<EmailAccount[]>();

  if (error) {
    console.error('[sending-domains:page] fetch failed', error);
  }

  return (
    <div className="min-h-screen bg-[#f5f2ee]">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6">
          <Link
            href="/dashboard/settings"
            className="mb-3 inline-flex items-center gap-1 text-xs text-[#4a4a5a] hover:text-[#1a1a1a]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M7 2L3 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to Settings
          </Link>
          <h1 className="text-xl font-semibold text-[#1a1a1a]">Sending domains</h1>
          <p className="mt-1 text-sm text-[#4a4a5a]">
            Configure where your campaign emails are sent from.
          </p>
        </header>

        <SendingDomainsClient accounts={(accounts ?? []) as EmailAccount[]} />
      </div>
    </div>
  );
}
