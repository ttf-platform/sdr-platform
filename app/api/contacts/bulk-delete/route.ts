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
  // Deleting contacts cascades to all their prospect assignments via ON DELETE CASCADE
  const { error, count } = await admin
    .from('contacts')
    .delete({ count: 'exact' })
    .in('id', ids)
    .eq('workspace_id', guard.workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: count ?? ids.length })
}
