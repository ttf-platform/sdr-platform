import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateICS } from '@/lib/ics'
import { MEETING_ICS_COLUMNS } from '@/lib/meetings-columns'
import { DASHBOARD_LOCALE_COOKIE, DEFAULT_DASHBOARD_LOCALE, type DashboardLocale } from '@/lib/locale'

// Owner-side locale resolution — mirrors middleware.ts:24-30 EXACTLY.
// Priority : bespoke dashboard cookie (set at login) → next-intl cookie
// → 'en'. Client-side readDashboardLocaleSync at lib/locale.ts:52 is
// guarded by `typeof document` and would return the default in a server
// bundle, hence the direct cookie parse here.
function resolveOwnerLocale(request: NextRequest): DashboardLocale {
  const dashboard = request.cookies.get(DASHBOARD_LOCALE_COOKIE)?.value
  if (dashboard === 'en' || dashboard === 'fr') return dashboard
  const nextLocale = request.cookies.get('NEXT_LOCALE')?.value
  if (nextLocale === 'en' || nextLocale === 'fr') return nextLocale
  return DEFAULT_DASHBOARD_LOCALE
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    locale:          resolveOwnerLocale(request),
  })
  return new NextResponse(ics, {
    headers: {
      'Content-Type':        'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="meeting-${meeting.id}.ics"`,
    },
  })
}
