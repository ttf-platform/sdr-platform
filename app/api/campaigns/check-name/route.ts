import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')?.trim()
  if (!name) return NextResponse.json({ available: true })

  const safeName = name.replace(/%/g, '\\%').replace(/_/g, '\\_')
  const admin = createAdminClient()
  const { count } = await admin
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', guard.workspaceId)
    .ilike('name', safeName)

  return NextResponse.json({ available: (count ?? 0) === 0 })
}
