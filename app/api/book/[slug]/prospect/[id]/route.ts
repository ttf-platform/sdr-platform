import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimitByIp } from '@/lib/rate-limit'

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string; id: string }> }
) {
  // Public endpoint — one prospect UUID per legitimate session (email link
  // deep-link). 10/min lets refresh + burst through and cuts leaked-id
  // enumeration cost to negligible bandwidth (still narrower than the
  // middleware's global 60/min ceiling, which counts across every route).
  const rl = await rateLimitByIp(request, { limit: 10, window: '1 m', prefix: 'booking-prospect' })
  if (!rl.allowed) return rl.response

  const params = await context.params
  const admin = createAdminClient()

  // Resolve workspace from booking slug
  const { data: profile } = await admin
    .from('workspace_profiles')
    .select('workspace_id')
    .eq('booking_slug', params.slug)
    .single()

  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Fetch prospect — only return name + company for form prefill. Email is
  // deliberately NOT returned : this endpoint is public and unauthenticated,
  // and the prospect's email is PII we don't want leaking through a
  // brute-forced UUID lookup. The form asks the attendee to type their
  // email themselves.
  const { data: prospect } = await admin
    .from('prospects')
    .select('first_name, last_name, company')
    .eq('id', params.id)
    .eq('workspace_id', profile.workspace_id)
    .single()

  if (!prospect) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    name:    [prospect.first_name, prospect.last_name].filter(Boolean).join(' '),
    company: prospect.company ?? '',
  })
}
