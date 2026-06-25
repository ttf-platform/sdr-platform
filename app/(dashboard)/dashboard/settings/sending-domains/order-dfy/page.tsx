/**
 * /app/(dashboard)/dashboard/settings/sending-domains/order-dfy/page.tsx
 *
 * Server Component — entry point of the DFY ordering wizard.
 * Reached by direct URL in A2a-UI-1b (the EmptyState / list CTA is wired
 * later in A2a-UI-2). The wizard itself is fully client-side.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { DfyOrderWizard } from '../_components/dfy-wizard/DfyOrderWizard';

export const metadata = {
  title: 'Order managed domain · Mirvo',
};

export default async function OrderDfyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
          <h1 className="text-xl font-semibold text-[#1a1a1a]">Order a managed sending domain</h1>
          <p className="mt-1 text-sm text-[#4a4a5a]">
            We&apos;ll register the domain, configure DNS, and warm it up automatically. You only pay once you confirm.
          </p>
        </header>

        <DfyOrderWizard />
      </div>
    </div>
  );
}
