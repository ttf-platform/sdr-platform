import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateICS } from '@/lib/ics'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: meeting, error } = await supabase
    .from('meetings').select('*').eq('id', params.id).single()
  if (error || !meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
