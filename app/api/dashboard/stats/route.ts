import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const wid = guard.workspaceId

  const [
    { data: recentCampaigns },
    { data: allCampaigns },
    { count: draftsCount },
    { data: scheduledMeetings },
    { data: negProspects },
    { data: wsProfile },
    { data: ws },
  ] = await Promise.all([
    admin.from('campaigns')
      .select('id, name, status, sent_count, open_count, reply_count, created_at')
      .eq('workspace_id', wid)
      .order('created_at', { ascending: false })
      .limit(5),
    admin.from('campaigns')
      .select('sent_count, open_count, reply_count')
      .eq('workspace_id', wid),
    admin.from('prospect_emails')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', wid)
      .in('status', ['draft', 'edited']),
    admin.from('meetings')
      .select('meeting_at')
      .eq('workspace_id', wid)
      .eq('status', 'scheduled'),
    admin.from('prospects')
      .select('contact_id')
      .eq('workspace_id', wid)
      .in('status', ['bounced', 'unsubscribed']),
    admin.from('workspace_profiles')
      .select('booking_config')
      .eq('workspace_id', wid)
      .single(),
    admin.from('workspaces')
      .select('name')
      .eq('id', wid)
      .single(),
  ])

  // KPI aggregates
  const totalCampaigns = allCampaigns?.length ?? 0
  const totalSent    = allCampaigns?.reduce((a, c) => a + (c.sent_count  ?? 0), 0) ?? 0
  const totalOpens   = allCampaigns?.reduce((a, c) => a + (c.open_count  ?? 0), 0) ?? 0
  const totalReplies = allCampaigns?.reduce((a, c) => a + (c.reply_count ?? 0), 0) ?? 0
  const openRate  = totalSent > 0 ? parseFloat(((totalOpens   / totalSent) * 100).toFixed(1)) : 0
  const replyRate = totalSent > 0 ? parseFloat(((totalReplies / totalSent) * 100).toFixed(1)) : 0

  // Meetings today in workspace timezone
  const tz = (wsProfile?.booking_config as any)?.timezone ?? 'UTC'
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  const meetingsToday = (scheduledMeetings ?? []).filter(m => {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(m.meeting_at))
    return d === todayStr
  }).length

  // Distinct contacts with bounce or unsub
  const needsAttention = new Set((negProspects ?? []).map(p => p.contact_id)).size

  return NextResponse.json({
    workspaceName: ws?.name ?? '',
    totalCampaigns,
    totalEmailsSent: totalSent,
    openRate,
    replyRate,
    recentCampaigns: (recentCampaigns ?? []).map(c => ({
      id: c.id,
      name: c.name,
      status: c.status,
      sentCount: c.sent_count ?? 0,
      openRate:  c.sent_count > 0 ? parseFloat(((c.open_count  / c.sent_count) * 100).toFixed(1)) : null,
      replyRate: c.sent_count > 0 ? parseFloat(((c.reply_count / c.sent_count) * 100).toFixed(1)) : null,
      createdAt: c.created_at,
    })),
    draftsToApprove: draftsCount ?? 0,
    meetingsToday,
    needsAttention,
  })
}
