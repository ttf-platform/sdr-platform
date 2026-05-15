import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { bulkIdsSchema, badRequest } from '@/lib/schemas'

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = bulkIdsSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { ids } = parsed.data

  const admin = createAdminClient()
  const { error, count } = await admin
    .from('prospects')
    .delete({ count: 'exact' })
    .in('id', ids)
    .eq('workspace_id', guard.workspaceId) // scoped to workspace — no cross-workspace deletes

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: count ?? ids.length })
}
