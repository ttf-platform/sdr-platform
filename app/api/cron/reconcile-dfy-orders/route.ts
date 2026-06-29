/**
 * GET /api/cron/reconcile-dfy-orders
 *
 * Polls the provider for the state of every DFY order we have locally in
 * status 'pending' or 'processing'. On completion, extracts the created
 * mailboxes + DNS records from the provider response and INSERTs them into
 * email_accounts, then flips the local dfy_orders row to 'completed'.
 *
 * Scheduled every 15 minutes via vercel.json. The cadence is intentionally
 * relaxed — DFY orders take 24-72h, so a slow poll is plenty.
 *
 * The route is strictly read-only on the provider side: it calls only
 * listDfyOrders (GET) — never createDfyOrder. Zero spending risk.
 *
 * Auth: standard CRON_SECRET via timingSafeEqual.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronComplete } from '@/lib/cron-log'
import { getEmailProvider, type DfyOrderStatus } from '@/lib/email-provider-adapter'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 60

const CRON_NAME = 'reconcile-dfy-orders'
// Cap to bound runtime in pathological cases. With 100 orders/page * 5 pages
// = 500 orders considered per run, plenty for V1.
const MAX_PAGES_PER_RUN = 5
// After ~24h of polling (96 attempts at 15min cadence + buffer) without a
// resolution, mark the order as failed so it stops consuming poll budget.
const MAX_POLL_ATTEMPTS = 120

interface ProviderOrderLike {
  id: string
  status: string | null
  raw: unknown
}

export async function GET(request: Request) {
  // ---- CRON_SECRET (constant-time) -----------------------------------------
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Misconfigured: CRON_SECRET not set' }, { status: 500 })
  }
  const authHeader = request.headers.get('authorization') ?? ''
  const expected   = `Bearer ${secret}`
  const provided   = Buffer.from(authHeader)
  const expectedBuf = Buffer.from(expected)
  const valid = provided.length === expectedBuf.length && timingSafeEqual(provided, expectedBuf)
  if (!valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  try {
  const admin    = createAdminClient()
  const provider = getEmailProvider()

  const summary = {
    open_orders:           0,
    polled:                0,
    completed:             0,
    failed:                0,
    still_pending:         0,
    accounts_created:      0,
    orphans:               0,  // local order without matching provider entry
    errors:                [] as string[],
  }

  // ---- Local rows to reconcile ---------------------------------------------
  const { data: openOrders, error: fetchErr } = await admin
    .from('dfy_orders')
    .select('id, workspace_id, provider_order_id, status, poll_attempts, items, placed_at')
    .in('status', ['pending', 'processing'])

  if (fetchErr) {
    console.error('[cron/reconcile-dfy-orders] fetch failed', fetchErr)
    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 500,
      payload: { error: 'db_fetch_failed', detail: fetchErr.message },
      started_at: startedAt,
      t0,
      error_message: fetchErr.message,
    })
  }
  summary.open_orders = openOrders?.length ?? 0
  if (!openOrders || openOrders.length === 0) {
    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 200,
      payload: { ...summary, timestamp: new Date().toISOString() },
      started_at: startedAt,
      t0,
    })
  }

  // ---- Provider-side snapshot: paginate the order list (read-only) ---------
  const providerOrders: ProviderOrderLike[] = []
  let cursor: string | undefined = undefined
  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    try {
      const res = await provider.listDfyOrders({ startingAfter: cursor, limit: 100 })
      providerOrders.push(...res.items)
      if (!res.nextStartingAfter) break
      cursor = res.nextStartingAfter
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error('[cron/reconcile-dfy-orders] provider list failed', msg)
      summary.errors.push(`provider_list_failed: ${msg}`)
      // Don't bail — we may still be able to mark stale orders as failed.
      break
    }
  }

  // Index by provider_order_id for O(1) match per local row
  const providerById = new Map<string, ProviderOrderLike>(
    providerOrders.map(o => [o.id, o]),
  )

  // ---- Reconcile each local row --------------------------------------------
  for (const local of openOrders) {
    summary.polled++

    const providerOrder = local.provider_order_id
      ? providerById.get(local.provider_order_id)
      : undefined

    if (!providerOrder) {
      // Either we have no provider_order_id, or it doesn't appear in the
      // current list. If we've polled enough times, give up.
      const nextAttempts = (local.poll_attempts ?? 0) + 1
      if (nextAttempts >= MAX_POLL_ATTEMPTS) {
        await admin.from('dfy_orders')
          .update({ status: 'failed', error_reason: 'no_matching_provider_order', poll_attempts: nextAttempts, last_polled_at: new Date().toISOString() })
          .eq('id', local.id)
        summary.failed++
        summary.orphans++
      } else {
        await admin.from('dfy_orders')
          .update({ poll_attempts: nextAttempts, last_polled_at: new Date().toISOString() })
          .eq('id', local.id)
        summary.still_pending++
      }
      continue
    }

    const providerStatus = (providerOrder.status ?? '').toLowerCase()

    if (providerStatus === 'completed' || providerStatus === 'success') {
      const accountsInserted = await materializeEmailAccounts(admin, local.id, local.workspace_id, providerOrder.raw)
      summary.accounts_created += accountsInserted

      await admin.from('dfy_orders')
        .update({
          status:         'completed',
          completed_at:   new Date().toISOString(),
          last_polled_at: new Date().toISOString(),
          poll_attempts:  (local.poll_attempts ?? 0) + 1,
        })
        .eq('id', local.id)
      summary.completed++
      continue
    }

    if (providerStatus === 'failed' || providerStatus === 'cancelled' || providerStatus === 'error') {
      await admin.from('dfy_orders')
        .update({
          status:         providerStatus === 'cancelled' ? 'cancelled' : 'failed',
          error_reason:   `provider_status=${providerStatus}`,
          last_polled_at: new Date().toISOString(),
          poll_attempts:  (local.poll_attempts ?? 0) + 1,
        })
        .eq('id', local.id)
      summary.failed++
      continue
    }

    // Still in flight — touch last_polled_at, bump counter, maybe time-out.
    const nextAttempts = (local.poll_attempts ?? 0) + 1
    const flipToFailed = nextAttempts >= MAX_POLL_ATTEMPTS
    await admin.from('dfy_orders')
      .update({
        status:         flipToFailed ? 'failed' : 'processing',
        error_reason:   flipToFailed ? 'poll_timeout' : null,
        last_polled_at: new Date().toISOString(),
        poll_attempts:  nextAttempts,
      })
      .eq('id', local.id)
    if (flipToFailed) summary.failed++
    else              summary.still_pending++
  }

  console.log(JSON.stringify({ event: 'cron_reconcile_dfy_orders', ...summary }))
  return cronComplete({
    cron_name: CRON_NAME,
    http_status_code: 200,
    payload: { ...summary, timestamp: new Date().toISOString() },
    started_at: startedAt,
    t0,
  })
  } catch (err) {
    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 500,
      payload: { error: 'unexpected_failure', detail: err instanceof Error ? err.message : 'unknown' },
      started_at: startedAt,
      t0,
      error_message: err instanceof Error ? err.message : 'unknown',
    })
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

type Admin = ReturnType<typeof createAdminClient>

// Extract created accounts + DNS records from the provider's order detail and
// insert one email_accounts row per created mailbox. Returns the number of
// rows inserted. Conservative: missing fields → skip the account, not crash.
async function materializeEmailAccounts(
  admin: Admin,
  dfyOrderId: string,
  workspaceId: string,
  rawProviderOrder: unknown,
): Promise<number> {
  if (!rawProviderOrder || typeof rawProviderOrder !== 'object') return 0
  const raw = rawProviderOrder as Record<string, unknown>

  // Provider order items live under either `order_items` or `items`.
  const orderItems = Array.isArray(raw.order_items)
    ? raw.order_items
    : Array.isArray(raw.items)
      ? raw.items
      : []

  let inserted = 0
  for (const rawItem of orderItems) {
    if (!rawItem || typeof rawItem !== 'object') continue
    const item = rawItem as Record<string, unknown>
    const domain = typeof item.domain === 'string' ? item.domain : null
    if (!domain) continue

    const accounts = Array.isArray(item.accounts) ? item.accounts : []
    const dnsRecords = extractDnsRecords(item)

    for (const rawAccount of accounts) {
      if (!rawAccount || typeof rawAccount !== 'object') continue
      const account = rawAccount as Record<string, unknown>

      const prefix    = typeof account.email_address_prefix === 'string' ? account.email_address_prefix : null
      const firstName = typeof account.first_name === 'string' ? account.first_name : ''
      const lastName  = typeof account.last_name === 'string'  ? account.last_name  : ''
      const emailAddress = typeof account.email_address === 'string'
        ? account.email_address
        : prefix ? `${prefix}@${domain}` : null
      const providerInboxId = typeof account.provider_account_id === 'string' ? account.provider_account_id
        : typeof account.account_id === 'string' ? account.account_id
        : null

      if (!emailAddress) continue

      // Upsert by (workspace_id, email_address) — table has UNIQUE constraint
      // so re-running the cron after a partial completion is idempotent.
      const { error } = await admin
        .from('email_accounts')
        .upsert({
          workspace_id:      workspaceId,
          domain,
          email_address:     emailAddress,
          sender_name:       `${firstName} ${lastName}`.trim() || emailAddress,
          provider_name:     'instantly',
          provider_inbox_id: providerInboxId,
          connection_type:   'dedicated',
          dns_records:       dnsRecords,
          warmup_status:     'pending',
          sending_phase:     1,
          setup_status:      'verified',  // DFY provider manages DNS auto
          dfy_order_id:      dfyOrderId,
        }, { onConflict: 'workspace_id,email_address', ignoreDuplicates: true })

      if (error) {
        console.error('[cron/reconcile-dfy-orders] email_account upsert failed', {
          email_address: emailAddress,
          workspace_id:  workspaceId,
          error:         error.message,
        })
        continue
      }
      inserted++
    }
  }
  return inserted
}

function extractDnsRecords(item: Record<string, unknown>): unknown {
  // The provider may surface DNS in different shapes; we just persist whatever
  // looks like a DNS payload. The setup_status='verified' marks the row as
  // DNS-already-managed by provider, so dns_records is informational only.
  if (item.dns_records && typeof item.dns_records === 'object') return item.dns_records
  if (item.dns && typeof item.dns === 'object')                 return item.dns
  return null
}
