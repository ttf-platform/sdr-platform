/**
 * /app/(dashboard)/dashboard/settings/sending-domains/order-dfy/page.tsx
 *
 * Server Component — entry point of the DFY ordering wizard.
 * Reached by direct URL in A2a-UI-1b (the EmptyState / list CTA is wired
 * later in A2a-UI-2). The wizard itself is fully client-side.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { DfyOrderWizard } from '../_components/dfy-wizard/DfyOrderWizard';
import { DfyOrderPageHeader } from './DfyOrderPageHeader';

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
        <DfyOrderPageHeader />
        <DfyOrderWizard />
      </div>
    </div>
  );
}
