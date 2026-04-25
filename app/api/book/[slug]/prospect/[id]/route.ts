import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(
  _: Request,
  { params }: { params: { slug: string; id: string } }
) {
  const admin = createAdminClient()

  // Resolve workspace from booking slug
  const { data: profile } = await admin
    .from('workspace_profiles')
    .select('workspace_id')
    .eq('booking_slug', params.slug)
    .single()

  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Fetch prospect — only return fields needed for form prefill
  const { data: prospect } = await admin
    .from('prospects')
    .select('first_name, last_name, email, company')
    .eq('id', params.id)
    .eq('workspace_id', profile.workspace_id)
    .single()

  if (!prospect) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    name:    [prospect.first_name, prospect.last_name].filter(Boolean).join(' '),
    email:   prospect.email,
    company: prospect.company ?? '',
  })
}
