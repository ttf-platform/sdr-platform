/**
 * /app/dashboard/settings/sending-domains/page.tsx
 *
 * Server Component: fetches the user's email accounts on initial load and
 * hands them to the Client wrapper for interactivity. RLS scopes the query
 * to the user's workspace automatically.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SendingDomainsClient } from './_components/SendingDomainsClient';
import type { EmailAccount } from './_components/SendingDomainCard';

export const metadata = {
  title: 'Sending domains · Mirvo',
};

export default async function SendingDomainsPage() {
  const supabase = createClient();

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
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[sending-domains:page] fetch failed', error);
  }

  return (
    <div className="min-h-screen bg-[#f5f2ee]">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6">
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
