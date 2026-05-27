/**
 * /app/(dashboard)/dashboard/settings/sending-domains/new/page.tsx
 *
 * Server Component — entry point of the 3-step wizard. Fetches the user's
 * email so Step 1 can detect "is this the user's main domain?" and show the
 * appropriate warning. Rest is delegated to the Client wrapper.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SendingDomainWizard } from '../_components/wizard/SendingDomainWizard';

export const metadata = {
  title: 'Add sending domain · Mirvo',
};

export default async function NewSendingDomainPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-[#f5f2ee]">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6">
          <Link
            href="/dashboard/settings/sending-domains"
            className="mb-3 inline-flex items-center gap-1 text-xs text-[#4a4a5a] hover:text-[#1a1a1a]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M7 2L3 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to sending domains
          </Link>
          <h1 className="text-xl font-semibold text-[#1a1a1a]">Add sending domain</h1>
          <p className="mt-1 text-sm text-[#4a4a5a]">
            We'll guide you through the setup in 3 steps. Most users finish in 5–10 minutes.
          </p>
        </header>

        <SendingDomainWizard userEmail={user.email ?? null} />
      </div>
    </div>
  );
}
