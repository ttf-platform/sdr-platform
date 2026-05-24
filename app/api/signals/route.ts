import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { signalCreateSchema, signalsListQuerySchema, badRequest } from '@/lib/schemas'

// GET /api/signals
// List all signals in workspace
//   ?is_active=true|false
//   &source_type=template|custom
//   &page=1&limit=50
export async function GET(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const { searchParams } = new URL(request.url)
  const parsed = signalsListQuerySchema.safeParse(Object.fromEntries(searchParams))
  if (!parsed.success) return badRequest(parsed.error.issues)

  const { is_active, source_type, page, limit } = parsed.data
  const offset = (page - 1) * limit

  const admin = createAdminClient()
  let query = admin
    .from('signals')
    .select('*', { count: 'exact' })
    .eq('workspace_id', guard.workspaceId)

  if (is_active !== undefined) query = query.eq('is_active', is_active)
  if (source_type) query = query.eq('source_type', source_type)

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    signals: data ?? [],
    total: count ?? 0,
    page,
    limit,
    pages: Math.ceil((count ?? 0) / limit),
  })
}

// POST /api/signals
// Create a new signal
export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const parsed = signalCreateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('signals')
    .insert({
      ...parsed.data,
      workspace_id: guard.workspaceId,
      created_by: guard.userId,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ signal: data }, { status: 201 })
}
