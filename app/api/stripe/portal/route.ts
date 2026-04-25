import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://sentra.app'

export async function POST() {
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('workspace_members').select('workspace_id')
    .eq('user_id', user.id).single()
  if (!member) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  const { data: ws } = await admin
    .from('workspaces').select('stripe_customer_id')
    .eq('id', member.workspace_id).single()

  if (!ws?.stripe_customer_id) {
    return NextResponse.json({ error: 'No Stripe customer found. Complete a checkout first.' }, { status: 400 })
  }

  const session = await stripe.billingPortal.sessions.create({
    customer:   ws.stripe_customer_id,
    return_url: `${APP_URL}/dashboard/billing`,
  })

  return NextResponse.json({ url: session.url })
}
