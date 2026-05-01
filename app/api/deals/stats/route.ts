import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

function getWeekBounds(tz: string) {
  const now = new Date()
  const day = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)).getDay()
  const daysFromMon = day === 0 ? 6 : day - 1
  const monday   = new Date(now.getTime() - daysFromMon * 86400000)
  const nextMon  = new Date(monday.getTime() + 7 * 86400000)
  return {
    start: monday.toISOString().split('T')[0],
    end:   nextMon.toISOString().split('T')[0],
  }
}

export async function GET() {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const wid = guard.workspaceId

  const [{ data: deals }, { data: wsProfile }, { data: meetings }] = await Promise.all([
    admin.from('deals').select('stage, amount').eq('workspace_id', wid),
    admin.from('workspace_profiles').select('booking_config').eq('workspace_id', wid).single(),
    admin.from('meetings').select('meeting_at').eq('workspace_id', wid).eq('status', 'scheduled'),
  ])

  const tz = (wsProfile?.booking_config as any)?.timezone ?? 'UTC'
  const week = getWeekBounds(tz)

  const totalLeads    = deals?.length ?? 0
  const activePipeline = (deals ?? []).filter(d => !['closed_won','closed_lost'].includes(d.stage)).length
  const won  = (deals ?? []).filter(d => d.stage === 'closed_won').length
  const lost = (deals ?? []).filter(d => d.stage === 'closed_lost').length
  const winRate = (won + lost) > 0 ? parseFloat(((won / (won + lost)) * 100).toFixed(1)) : null
  const totalCaWon = (deals ?? [])
    .filter(d => d.stage === 'closed_won' && d.amount != null)
    .reduce((sum, d) => sum + Number(d.amount), 0)

  const meetingsThisWeek = (meetings ?? []).filter(m => {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(m.meeting_at))
    return d >= week.start && d < week.end
  }).length

  return NextResponse.json({ totalLeads, activePipeline, winRate, totalCaWon, meetingsThisWeek })
}
