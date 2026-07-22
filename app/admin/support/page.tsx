import { getAdminSupabaseClient } from '@/lib/supabase-admin';
import { getAdminNotificationEmail } from '@/lib/admin-settings';
import { getAdminEmails } from '@/lib/admin-auth';
import { SupportCenterClient } from './_components/SupportCenterClient';

export const dynamic = 'force-dynamic';

export default async function SupportCenterPage() {
  const sb = getAdminSupabaseClient();

  // KPI counts (5 stats matching Firstsend layout) — parallel with the
  // notifications-configured check so the page loads in one round-trip.
  const [escalations, negSentiment, openBugs, conversations, feedback, notificationEmail] =
    await Promise.all([
      sb.from('escalations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      sb.from('bot_conversations').select('*', { count: 'exact', head: true }).eq('sentiment', 'negative'),
      sb
        .from('bug_reports')
        .select('*', { count: 'exact', head: true })
        .in('status', ['new', 'acknowledged', 'in_progress']),
      sb.from('bot_conversations').select('*', { count: 'exact', head: true }),
      sb.from('feedback').select('*', { count: 'exact', head: true }),
      getAdminNotificationEmail(),
    ]);

  const kpis = {
    escalations: escalations.count ?? 0,
    negativeSentiment: negSentiment.count ?? 0,
    openBugs: openBugs.count ?? 0,
    conversations: conversations.count ?? 0,
    feedback: feedback.count ?? 0,
  };

  // The badge in the header advertised "Notifs: env-configured" in hard-coded
  // text pre-fix. Now it reflects reality : `notificationsConfigured` is
  // true when getAdminNotificationEmail returned a non-null address (DB
  // setting OR the ADMIN_NOTIFICATION_EMAIL env var), `adminCount` is the
  // count of admins in SENTRA_ADMIN_EMAILS. When both are zero the amber
  // "not configured" state warns the operator that alerts have nowhere to
  // land.
  const notificationsConfigured = notificationEmail !== null;
  const adminCount = getAdminEmails().length;

  return (
    <SupportCenterClient
      kpis={kpis}
      notificationsConfigured={notificationsConfigured}
      adminCount={adminCount}
    />
  );
}
