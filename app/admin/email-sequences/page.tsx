// Guarded by app/admin/layout.tsx (requireSentraAdmin() throws → redirects
// to /login when unauthenticated / to /dashboard when signed-in-non-admin).
import { EmailSequencesClient } from './_components/EmailSequencesClient'

export const dynamic = 'force-dynamic'

export default function AdminEmailSequencesPage() {
  return <EmailSequencesClient />
}
