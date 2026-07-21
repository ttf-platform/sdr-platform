import { redirect } from 'next/navigation';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { AdminSidebar } from './_components/AdminSidebar';

export const dynamic = 'force-dynamic';

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
    <div className="flex min-h-screen bg-[#fafaf9]">
      <AdminSidebar />
      <main className="flex-1 overflow-x-hidden pt-14 md:pt-0">{children}</main>
    </div>
  );
}
