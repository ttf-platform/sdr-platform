import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { checkTotalProspectsLimit } from '@/lib/tier-limits'
import { createAdminClient } from '@/lib/supabase/admin'

// enrichment_data : données provider externe (Sprint 9 Clay)
// custom_data     : données user-defined (tags/notes, Sprint 16d+)

function normalizeEmail(raw: string): string | null {
  const trimmed = (raw ?? '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null
}

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const body = await request.json()
  const { campaign_id, mode, data } = body

  if (!['manual', 'paste', 'csv'].includes(mode)) {
    return NextResponse.json({ error: 'Invalid mode. Expected: manual | paste | csv' }, { status: 400 })
  }

  type ProspectRow = {
    email: string
    first_name?: string | null
    last_name?: string | null
    company?: string | null
    title?: string | null
    linkedin_url?: string | null
    website?: string | null
  }

  let rows: ProspectRow[] = []
  let skipped_invalid = 0

  if (mode === 'manual') {
    const email = normalizeEmail(data?.email ?? '')
    if (!email) return NextResponse.json({ error: 'Invalid or missing email' }, { status: 400 })
    rows = [{
      email,
      first_name:   data.first_name   ?? null,
      last_name:    data.last_name    ?? null,
      company:      data.company      ?? null,
      title:        data.title        ?? null,
      linkedin_url: data.linkedin_url ?? null,
    }]

  } else if (mode === 'paste') {
    const rawEmails: string[] = Array.isArray(data?.emails) ? data.emails : []
    for (const raw of rawEmails) {
      const email = normalizeEmail(raw)
      if (email) rows.push({ email })
      else skipped_invalid++
    }

  } else { // csv
    const csvRows: any[] = Array.isArray(data?.rows) ? data.rows : []
    for (const r of csvRows) {
      const email = normalizeEmail(r.email ?? '')
      if (!email) { skipped_invalid++; continue }
      rows.push({
        email,
        first_name:   r.first_name   ?? null,
        last_name:    r.last_name    ?? null,
        company:      r.company      ?? null,
        title:        r.title        ?? null,
        linkedin_url: r.linkedin_url ?? null,
        website:      r.website      ?? null,
      })
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({ imported: 0, skipped_dedup: 0, skipped_invalid, total_now: 0 })
  }

  // Cap enforcement: COUNT(*) from prospects table, then check before INSERT.
  // Known limitation: concurrent imports may briefly exceed cap (acceptable Sprint 16b).
  const capCheck = await checkTotalProspectsLimit(guard.workspaceId, rows.length)
  if (!capCheck.allowed) {
    return NextResponse.json(
      { error: capCheck.reason, cap: capCheck.cap, current: capCheck.currentCount },
      { status: 429 },
    )
  }

  const source = mode === 'manual' ? 'manual' : mode === 'paste' ? 'paste' : 'csv_import'

  const inserts = rows.map(r => ({
    workspace_id: guard.workspaceId, // always forced — workspace_id nullable anomaly documented (Sprint 17 NOT NULL)
    campaign_id:  campaign_id ?? null,
    email:        r.email,
    first_name:   r.first_name  ?? null,
    last_name:    r.last_name   ?? null,
    company:      r.company     ?? null,
    title:        r.title       ?? null,
    linkedin_url: r.linkedin_url ?? null,
    website:      r.website     ?? null,
    source,
    status: 'found',
  }))

  const admin = createAdminClient()

  // ON CONFLICT DO NOTHING — no explicit target, Postgres matches against any unique index
  // including the partial index (campaign_id, email) WHERE campaign_id IS NOT NULL (migration 012).
  // Using ignoreDuplicates without onConflict avoids PostgREST failing to resolve partial indexes.
  // Rows with campaign_id IS NULL have no dedup constraint by design (re-targeting allowed).
  const { data: inserted, error } = await admin
    .from('prospects')
    .upsert(inserts, { ignoreDuplicates: true })
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const imported      = inserted?.length ?? 0
  const skipped_dedup = rows.length - imported

  const { count: total_now } = await admin
    .from('prospects')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', guard.workspaceId)

  return NextResponse.json({ imported, skipped_dedup, skipped_invalid, total_now: total_now ?? 0 }, { status: 201 })
}
