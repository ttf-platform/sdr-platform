import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateICS } from '@/lib/ics'
import { MEETING_ICS_COLUMNS } from '@/lib/meetings-columns'

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Explicit allowlist — see lib/meetings-columns.ts::MEETING_ICS_COLUMNS.
  // generateICS spreads the meeting object into an ICSMeeting shape ; the
  // pre-allowlist .select('*') passed through confirmation_token +
  // attendee_email_normalized + confirmation_sent_at + expires_at into the
  // spread even though generateICS never renders them. Vendor-invisibility
  // + defence-in-depth : keep secrets and anti-abuse internals out of the
  // object graph, not just out of the rendered output.
  const { data: meeting, error } = await supabase
    .from('meetings').select(MEETING_ICS_COLUMNS).eq('id', params.id).single()
  if (error || !meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Never emit an ICS for an unconfirmed public booking : the slot isn't
  // reserved and the attendee would be tricked into adding a meeting the
  // host doesn't have on their calendar. Same for 'expired'.
  if (meeting.status === 'pending' || meeting.status === 'expired') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const ics = generateICS({
    ...meeting,
    organizer_email: user.email                    ?? '',
    organizer_name:  user.user_metadata?.full_name ?? '',
    perspective:     'organizer',
  })
  return new NextResponse(ics, {
    headers: {
      'Content-Type':        'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="meeting-${meeting.id}.ics"`,
    },
  })
}
