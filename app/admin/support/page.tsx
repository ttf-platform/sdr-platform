import { getAdminSupabaseClient } from '@/lib/supabase-admin';
import { SupportCenterClient } from './_components/SupportCenterClient';

export const dynamic = 'force-dynamic';

export default async function SupportCenterPage() {
  const sb = getAdminSupabaseClient();

  // KPI counts (5 stats matching Firstsend layout)
  const [escalations, negSentiment, openBugs, conversations, feedback] =
    await Promise.all([
      sb.from('escalations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      sb.from('bot_conversations').select('*', { count: 'exact', head: true }).eq('sentiment', 'negative'),
      sb
        .from('bug_reports')
        .select('*', { count: 'exact', head: true })
        .in('status', ['new', 'acknowledged', 'in_progress']),
      sb.from('bot_conversations').select('*', { count: 'exact', head: true }),
      sb.from('feedback').select('*', { count: 'exact', head: true }),
    ]);

  const kpis = {
    escalations: escalations.count ?? 0,
    negativeSentiment: negSentiment.count ?? 0,
    openBugs: openBugs.count ?? 0,
    conversations: conversations.count ?? 0,
    feedback: feedback.count ?? 0,
  };

  return <SupportCenterClient kpis={kpis} />;
}
