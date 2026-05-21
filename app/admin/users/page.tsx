import { requireSentraAdmin } from '@/lib/admin-auth';
import { UsersListClient } from './_components/UsersListClient';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const admin = await requireSentraAdmin();
  return <UsersListClient currentAdminId={admin.id} />;
}
