import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: expired, error: selectError } = await admin
    .from('workspaces')
    .select('id, name, trial_end_date')
    .eq('subscription_status', 'trialing')
    .lt('trial_end_date', new Date().toISOString())

  if (selectError) {
    console.error('[cron/trial-expiry] Select error:', selectError)
    return NextResponse.json({ error: 'Select failed', detail: selectError.message }, { status: 500 })
  }

  if (!expired || expired.length === 0) {
    return NextResponse.json({ message: 'No expired trials to update', count: 0 })
  }

  const ids = expired.map(w => w.id)
  const { error: updateError } = await admin
    .from('workspaces')
    .update({ subscription_status: 'expired' })
    .in('id', ids)

  if (updateError) {
    console.error('[cron/trial-expiry] Update error:', updateError)
    return NextResponse.json({ error: 'Update failed', detail: updateError.message }, { status: 500 })
  }

  console.log(`[cron/trial-expiry] Transitioned ${expired.length} workspaces to expired`)
  return NextResponse.json({
    message: 'Trial expiry transition complete',
    count: expired.length,
    workspace_ids: ids,
  })
}
