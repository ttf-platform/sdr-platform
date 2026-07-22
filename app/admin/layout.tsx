import { redirect } from 'next/navigation';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { AdminSidebar } from './_components/AdminSidebar';
import { AdminIntlProvider } from './_components/AdminIntlProvider';

export const dynamic = 'force-dynamic';

/**
 * /admin/* lives OUTSIDE the [locale] route group (deliberate : the admin
 * back-office is EN-only and shouldn't participate in the user-facing FR/EN
 * routing). But shared UI components (Modal, StatusBadge, …) call
 * `useTranslations` unconditionally at mount, so without a provider under
 * this subtree they throw "No intl context was found" and take the whole
 * page down.
 *
 * Wrap in `AdminIntlProvider` (a 'use client' boundary) that mounts a
 * locale-forced NextIntlClientProvider. The client boundary is required :
 * importing NextIntlClientProvider directly in this server layout would
 * pull next-intl's server-side helpers, which call `notFound()` when the
 * middleware hasn't populated a locale (the middleware never runs on /admin
 * — that's the whole point of the layout living outside `[locale]`). Same
 * pattern as `app/(dashboard)/layout.tsx`.
 *
 * The admin guard runs BEFORE the provider so an unauthenticated hit
 * redirects without ever loading messages.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireSentraAdmin();
  } catch (err) {
    if (err instanceof AdminAuthError) {
      if (err.code === 'unauthorized') redirect('/login?redirect=/admin');
      // forbidden = signed in but not an admin → bounce to dashboard
      redirect('/dashboard');
    }
    throw err;
  }

  return (
    <AdminIntlProvider>
      <div className="flex min-h-screen bg-[#fafaf9]">
        <AdminSidebar />
        <main className="flex-1 overflow-x-hidden pt-14 md:pt-0">{children}</main>
      </div>
    </AdminIntlProvider>
  );
}
