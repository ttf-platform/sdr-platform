import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { TIER_CAPS } from '@/lib/tier-limits'
import type { PlanTier } from '@/lib/stripe-prices'

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

  type InputRow = {
    email: string
    first_name?: string | null
    last_name?: string | null
    company?: string | null
    title?: string | null
    linkedin_url?: string | null
    website?: string | null
  }

  let rows: InputRow[] = []
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
    return NextResponse.json({
      imported_contacts: 0, updated_contacts: 0,
      imported_assignments: 0, skipped_assignments_dedup: 0,
      skipped_invalid, total_contacts_now: 0,
    })
  }

  const admin = createAdminClient()

  // Fetch existing contacts for these emails to compute COALESCE merge and precise new count
  const emailList = rows.map(r => r.email)
  const { data: existing } = await admin
    .from('contacts')
    .select('id, email, first_name, last_name, company, title, linkedin_url, website')
    .eq('workspace_id', guard.workspaceId)
    .in('email', emailList)

  const existingMap = new Map((existing ?? []).map(c => [c.email, c]))

  const imported_contacts_count = rows.filter(r => !existingMap.has(r.email)).length
  const updated_contacts_count  = rows.filter(r =>  existingMap.has(r.email)).length

  // Precise cap check: only new contacts count against the cap
  if (imported_contacts_count > 0) {
    const { data: ws } = await admin
      .from('workspaces').select('plan_tier')
      .eq('id', guard.workspaceId).single()
    const tier = (ws?.plan_tier ?? 'starter') as PlanTier
    const cap  = TIER_CAPS[tier].total_prospects

    const { count: currentCount } = await admin
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', guard.workspaceId)

    if ((currentCount ?? 0) + imported_contacts_count > cap) {
      return NextResponse.json(
        { error: `You've reached your contact limit (${cap.toLocaleString()} total). Upgrade to import more.`, cap, current: currentCount },
        { status: 429 },
      )
    }
  }

  // Build merged contact rows: COALESCE in JS — new non-null value wins, else keep existing
  const contactUpserts = rows.map(r => {
    const ex = existingMap.get(r.email)
    return {
      workspace_id: guard.workspaceId,
      email:        r.email,
      first_name:   r.first_name   ?? ex?.first_name   ?? null,
      last_name:    r.last_name    ?? ex?.last_name    ?? null,
      company:      r.company      ?? ex?.company      ?? null,
      title:        r.title        ?? ex?.title        ?? null,
      linkedin_url: r.linkedin_url ?? ex?.linkedin_url ?? null,
      website:      r.website      ?? ex?.website      ?? null,
    }
  })

  // Upsert contacts — values already COALESCE-merged, so standard upsert is safe
  const { data: upsertedContacts, error: contactError } = await admin
    .from('contacts')
    .upsert(contactUpserts, { onConflict: 'workspace_id,email' })
    .select('id, email')

  if (contactError) return NextResponse.json({ error: contactError.message }, { status: 500 })

  let imported_assignments      = 0
  let skipped_assignments_dedup = 0

  // Step 2: create prospect assignments if campaign_id is given
  if (campaign_id && upsertedContacts && upsertedContacts.length > 0) {
    const contactIdMap = new Map(upsertedContacts.map(c => [c.email, c.id]))
    const source = mode === 'manual' ? 'manual' : mode === 'paste' ? 'paste' : 'csv_import'

    const assignments = rows
      .filter(r => contactIdMap.has(r.email))
      .map(r => ({
        workspace_id: guard.workspaceId,
        campaign_id,
        contact_id:   contactIdMap.get(r.email)!,
        email:        r.email, // denormalized for query perf — synced from contacts.email
        source,
        status:       'found',
      }))

    // ignoreDuplicates: true = ON CONFLICT DO NOTHING — works with partial unique index
    const { data: insertedAssignments, error: assignError } = await admin
      .from('prospects')
      .upsert(assignments, { ignoreDuplicates: true })
      .select('id')

    if (assignError) return NextResponse.json({ error: assignError.message }, { status: 500 })

    imported_assignments      = insertedAssignments?.length ?? 0
    skipped_assignments_dedup = assignments.length - imported_assignments
  }

  const { count: total_contacts_now } = await admin
    .from('contacts')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', guard.workspaceId)

  return NextResponse.json({
    imported_contacts:      imported_contacts_count,
    updated_contacts:       updated_contacts_count,
    imported_assignments,
    skipped_assignments_dedup,
    skipped_invalid,
    total_contacts_now:     total_contacts_now ?? 0,
  }, { status: 201 })
}
