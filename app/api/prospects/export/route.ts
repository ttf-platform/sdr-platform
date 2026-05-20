import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimitByWorkspace } from '@/lib/rate-limit'
import { csvUuidArray, badRequest } from '@/lib/schemas'
import { sanitizeRow } from '@/lib/sanitize-export'

const MAX_SYNC_EXPORT = 10_000

const exportQuerySchema = z.object({
  format:      z.enum(['csv', 'xlsx']),
  campaign_id: z.string().uuid().optional(),
  status:      z.string().optional(),
  source:      z.string().optional(),
  search:      z.string().max(200).optional(),
  date_from:   z.string().datetime({ offset: true }).optional(),
  date_to:     z.string().datetime({ offset: true }).optional(),
  columns:     z.string().optional(),
  tag_ids:     csvUuidArray,
  selected_ids: csvUuidArray,
})

const ALL_COLUMNS = ['email', 'first_name', 'last_name', 'company', 'title', 'linkedin_url', 'website', 'status', 'source', 'tags', 'notes', 'added_at'] as const
const DEFAULT_COLUMNS = ['email', 'first_name', 'last_name', 'company', 'title', 'status', 'tags', 'added_at']

const STATUS_PRIORITY: Record<string, number> = {
  meeting: 4, replied: 3, opened: 2, emailed: 1, found: 0,
}

export async function GET(req: NextRequest) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const rl = await rateLimitByWorkspace(guard.workspaceId, {
    limit: 5, window: '1 m', prefix: 'prospects-export',
  })
  if (!rl.allowed) return rl.response

  const qp = Object.fromEntries(req.nextUrl.searchParams)
  const parsed = exportQuerySchema.safeParse(qp)
  if (!parsed.success) return badRequest(parsed.error.issues)

  const { format, campaign_id, status, source, search, date_from, date_to, columns: columnsParam, tag_ids, selected_ids } = parsed.data

  const admin = createAdminClient()
  const startTime = Date.now()

  // ── 1. Resolve contact IDs from filters ──────────────────────────────────────

  let contactIds: string[] | null = null

  // Bulk selection: export only the selected contact IDs
  if (selected_ids.length > 0) {
    contactIds = selected_ids
  } else if (campaign_id || status || source || tag_ids.length > 0) {
    let q = admin
      .from('prospects')
      .select('contact_id')
      .eq('workspace_id', guard.workspaceId)

    if (campaign_id) q = q.eq('campaign_id', campaign_id)
    if (status) q = q.in('status', status.split(',').filter(Boolean))
    if (source) q = q.in('source', source.split(',').filter(Boolean))

    let taggedContactIds: string[] | null = null
    if (tag_ids.length > 0) {
      const { data: tagRows } = await admin
        .from('prospect_tag_assignments')
        .select('prospect_id')
        .in('tag_id', tag_ids)

      const taggedPids = (tagRows ?? []).map((r: any) => r.prospect_id as string)
      if (taggedPids.length > 0) {
        const { data: taggedProspects } = await admin
          .from('prospects')
          .select('contact_id')
          .in('id', taggedPids)
          .eq('workspace_id', guard.workspaceId)
        taggedContactIds = [...new Set((taggedProspects ?? []).map((r: any) => r.contact_id as string))]
      } else {
        taggedContactIds = []
      }
    }

    const { data: filterRows } = await q
    let ids = [...new Set((filterRows ?? []).map((r: any) => r.contact_id as string))]
    if (taggedContactIds !== null) {
      const tagSet = new Set(taggedContactIds)
      ids = ids.filter(id => tagSet.has(id))
    }
    contactIds = ids

    if (contactIds.length === 0) {
      return buildEmptyExport(format)
    }
  }

  // ── 2. Overflow guard ────────────────────────────────────────────────────────

  if (contactIds && contactIds.length > MAX_SYNC_EXPORT) {
    return NextResponse.json({
      error: `Too many prospects (${contactIds.length.toLocaleString()} > ${MAX_SYNC_EXPORT.toLocaleString()}). Please refine your filters to export fewer at a time.`,
    }, { status: 413 })
  }

  // ── 3. Fetch contacts ────────────────────────────────────────────────────────

  let contactQuery = admin
    .from('contacts')
    .select('*, prospects!contact_id(id, campaign_id, status, source, added_at)')
    .eq('workspace_id', guard.workspaceId)

  if (contactIds) contactQuery = contactQuery.in('id', contactIds)

  if (search) {
    const q = search.replace(/'/g, "''")
    contactQuery = contactQuery.or(
      `email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,company.ilike.%${q}%`,
    )
  }
  if (date_from) contactQuery = contactQuery.gte('added_at', date_from)
  if (date_to)   contactQuery = contactQuery.lte('added_at', date_to)

  // Count-only check before full fetch when no contactIds list (no filter applied)
  if (!contactIds) {
    const { count } = await admin
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', guard.workspaceId)

    if ((count ?? 0) > MAX_SYNC_EXPORT) {
      return NextResponse.json({
        error: `Too many prospects (${(count ?? 0).toLocaleString()} > ${MAX_SYNC_EXPORT.toLocaleString()}). Please refine your filters to export fewer at a time.`,
      }, { status: 413 })
    }
  }

  const { data: rawContacts, error: contactsError } = await contactQuery
    .order('added_at', { ascending: false })
    .limit(MAX_SYNC_EXPORT)

  if (contactsError) return NextResponse.json({ error: contactsError.message }, { status: 500 })

  const allContacts = rawContacts ?? []
  const returnedContactIds = allContacts.map((c: any) => c.id as string)

  if (allContacts.length === 0) return buildEmptyExport(format)

  // ── 4. Fetch tags ────────────────────────────────────────────────────────────

  const tagsPerContact: Record<string, string[]> = {}

  if (returnedContactIds.length > 0) {
    const { data: tagRows } = await admin
      .from('prospects')
      .select('contact_id, prospect_tag_assignments(prospect_tags(label))')
      .in('contact_id', returnedContactIds)
      .eq('workspace_id', guard.workspaceId)

    for (const row of (tagRows ?? []) as any[]) {
      const cid = row.contact_id as string
      if (!tagsPerContact[cid]) tagsPerContact[cid] = []
      for (const assignment of (row.prospect_tag_assignments ?? [])) {
        const label = assignment.prospect_tags?.label
        if (label && !tagsPerContact[cid].includes(label)) {
          tagsPerContact[cid].push(label)
        }
      }
    }
  }

  // ── 5. Fetch notes (via prospect IDs) ────────────────────────────────────────

  const notesPerContact: Record<string, string[]> = {}
  const allProspectIds: string[] = allContacts.flatMap((c: any) =>
    (c.prospects ?? []).map((p: any) => p.id as string),
  )

  if (allProspectIds.length > 0) {
    const { data: noteRows } = await admin
      .from('prospect_notes')
      .select('prospect_id, content, created_at')
      .in('prospect_id', allProspectIds)
      .order('created_at', { ascending: true })

    // Map prospect_id → contact_id
    const prospectToContact: Record<string, string> = {}
    for (const c of allContacts as any[]) {
      for (const p of (c.prospects ?? [])) {
        prospectToContact[p.id] = c.id
      }
    }

    for (const note of (noteRows ?? []) as any[]) {
      const cid = prospectToContact[note.prospect_id]
      if (!cid) continue
      if (!notesPerContact[cid]) notesPerContact[cid] = []
      const dateStr = new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      notesPerContact[cid].push(`[${dateStr}] ${note.content}`)
    }
  }

  // ── 6. Aggregate primary status/source per contact ───────────────────────────

  const selectedColumns = columnsParam
    ? columnsParam.split(',').filter(c => (ALL_COLUMNS as readonly string[]).includes(c))
    : DEFAULT_COLUMNS

  // ── 7. Build rows ────────────────────────────────────────────────────────────

  const rows = (allContacts as any[]).map(c => {
    const assignments: any[] = (c.prospects ?? []).filter((p: any) => p.campaign_id)
    let primaryStatus = 'found'
    let primarySource = 'manual'
    let bestPriority = -1
    for (const a of assignments) {
      const p = STATUS_PRIORITY[a.status] ?? 0
      if (p > bestPriority) { primaryStatus = a.status; primarySource = a.source; bestPriority = p }
    }

    const allFields: Record<string, string> = {
      email:        c.email ?? '',
      first_name:   c.first_name ?? '',
      last_name:    c.last_name ?? '',
      company:      c.company ?? '',
      title:        c.title ?? '',
      linkedin_url: c.linkedin_url ?? '',
      website:      c.website ?? '',
      status:       primaryStatus,
      source:       primarySource,
      tags:         (tagsPerContact[c.id] ?? []).join(', '),
      notes:        (notesPerContact[c.id] ?? []).join(' | '),
      added_at:     c.added_at ? new Date(c.added_at).toISOString().split('T')[0] : '',
    }

    const row: Record<string, string> = {}
    for (const col of selectedColumns) row[col] = allFields[col] ?? ''
    return row
  })

  // ── 8. Generate file ─────────────────────────────────────────────────────────

  // Sanitize after all concatenation (tags join, notes join) to catch injected prefixes
  const safeRows = rows.map(r => sanitizeRow(r))

  const durationMs = Date.now() - startTime
  const dateStr    = new Date().toISOString().split('T')[0]

  let fileBuffer: Buffer
  let contentType: string
  let filename: string

  if (format === 'csv') {
    const csv = Papa.unparse(safeRows)
    fileBuffer  = Buffer.from('\uFEFF' + csv, 'utf-8') // BOM for Excel UTF-8
    contentType = 'text/csv; charset=utf-8'
    filename    = `sentra-prospects-${dateStr}.csv`
  } else {
    const wb  = XLSX.utils.book_new()
    const ws  = XLSX.utils.json_to_sheet(safeRows)
    XLSX.utils.book_append_sheet(wb, ws, 'Prospects')
    fileBuffer  = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    filename    = `sentra-prospects-${dateStr}.xlsx`
  }

  // ── 9. Audit log (fire-and-forget, don't block response) ─────────────────────

  void Promise.resolve(admin.from('export_history').insert({
    workspace_id: guard.workspaceId,
    user_id:      guard.userId,
    format,
    filters:      { campaign_id, status, source, tag_ids, search, date_from, date_to, selected_ids: selected_ids.length > 0 ? selected_ids.length : undefined },
    columns:      selectedColumns,
    row_count:    rows.length,
    duration_ms:  durationMs,
  })).catch(() => {})

  return new NextResponse(fileBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type':        contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      String(fileBuffer.length),
    },
  })
}

function buildEmptyExport(format: 'csv' | 'xlsx'): NextResponse {
  const dateStr = new Date().toISOString().split('T')[0]
  if (format === 'csv') {
    return new NextResponse(Buffer.from('\uFEFFemail,first_name,last_name,company,title,status,tags,added_at\n', 'utf-8') as unknown as BodyInit, {
      headers: {
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sentra-prospects-${dateStr}.csv"`,
      },
    })
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['email','first_name','last_name','company','title','status','tags','added_at']]), 'Prospects')
  const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="sentra-prospects-${dateStr}.xlsx"`,
    },
  })
}
