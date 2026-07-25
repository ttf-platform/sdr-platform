// Guarded by app/admin/layout.tsx (requireSentraAdmin() throws → redirects
// to /login when unauthenticated / to /dashboard when signed-in-non-admin).
import { PlansClient } from './_components/PlansClient'

export const dynamic = 'force-dynamic'

export default function AdminPlansPage() {
  return <PlansClient />
}
