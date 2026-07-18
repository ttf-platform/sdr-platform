/**
 * POST /api/email-accounts/dfy-order
 *
 * Place a DFY (Done-For-You) provisioning order, OR fetch a quote first.
 *
 * Body shape (Zod-validated): { orderType, items, simulate? }
 *   simulate defaults to TRUE if absent — quotes never trigger an order.
 *
 * Two paths:
 *   simulate=true  → call provider with simulation=true, return the quote.
 *                    No DB row, no charge.
 *   simulate=false → real order. Capped at MAX_REAL_DFY_ORDERS per workspace.
 *                    Explicit structured log emitted BEFORE the provider call
 *                    with workspace_id, user_id, items snapshot, and totals.
 *                    On order_placed=true, INSERT a row in dfy_orders for the
 *                    reconciliation cron to follow up on.
 *
 * The route never touches email_accounts / the legacy sync flow — the
 * reconciliation cron creates email_accounts rows on completion.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmailProvider } from '@/lib/email-provider-adapter'
import { rateLimitByWorkspace } from '@/lib/rate-limit'
import { createDfyOrderRequestSchema, badRequest } from '@/lib/schemas'

// Hard cap: this is the only place in the app that can spend real money on
// the user's behalf. Bug or abuse must not snowball into a large bill.
// Increase only after explicit business sign-off.
const MAX_REAL_DFY_ORDERS = 5

export async function POST(request: Request) {
  const supabase = await createClient()

  // --- Auth ---
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // --- Body ---
  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = createDfyOrderRequestSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { orderType, items, simulate } = parsed.data

  // --- Workspace ---
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()
  if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  const workspaceId = membership.workspace_id

  // --- Rate limit (tight: each click costs a provider call) ---
  const rl = await rateLimitByWorkspace(workspaceId, { limit: 10, window: '1 m', prefix: 'dfy-order' })
  if (!rl.allowed) return rl.response

  const provider = getEmailProvider()

  // ============================================================================
  // SIMULATE — quote only, no DB write, no charge
  // ============================================================================
  if (simulate === true) {
    try {
      const result = await provider.createDfyOrder({ orderType, items, simulate: true })
      return NextResponse.json({ quote: result }, { status: 200 })
    } catch (err) {
      console.error('[dfy-order:simulate] provider error', err)
      return NextResponse.json(
        { error: 'Could not fetch quote', message: err instanceof Error ? err.message : 'unknown' },
        { status: 502 },
      )
    }
  }

  // ============================================================================
  // REAL ORDER — spends money. Two-phase flow:
  //   (1) reserve_dfy_order_slot RPC: atomic cap-check + INSERT 'pending' row
  //   (2) provider call
  //   (3) UPDATE the reserved row with provider data (success) or 'failed'
  // The cap is consumed BEFORE any provider call, so parallel requests cannot
  // overshoot regardless of the per-workspace rate-limit ceiling.
  // ============================================================================

  const admin = createAdminClient()
  const numDomains  = items.length
  const numAccounts = items.reduce((s, it) => s + it.accounts.length, 0)
  const providerName = process.env.MOCK_EMAIL_PROVIDER === 'true' ? 'mock' : 'instantly'

  // --- Audit log: intent (before reservation, so a crash mid-reserve leaves a trace) ---
  console.log(JSON.stringify({
    event:        'dfy_real_order_attempt',
    workspace_id: workspaceId,
    user_id:      user.id,
    order_type:   orderType,
    num_domains:  numDomains,
    num_accounts: numAccounts,
    domains:      items.map(it => it.domain),
    timestamp:    new Date().toISOString(),
  }))

  // --- (1) Atomic reservation (cap + INSERT serialized via advisory lock) ---
  const { data: reservationId, error: rpcErr } = await admin.rpc('reserve_dfy_order_slot', {
    p_workspace_id:  workspaceId,
    p_max:           MAX_REAL_DFY_ORDERS,
    p_user_id:       user.id,
    p_provider_name: providerName,
    p_order_type:    orderType,
    p_items:         items,
    p_num_domains:   numDomains,
    p_num_accounts:  numAccounts,
  })

  if (rpcErr) {
    console.error('[dfy-order:real] reservation rpc failed', rpcErr)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  if (reservationId === null) {
    return NextResponse.json(
      {
        error: 'dfy_order_cap_reached',
        message: `This workspace has reached the DFY order cap of ${MAX_REAL_DFY_ORDERS}. Contact support to raise the limit.`,
        cap: MAX_REAL_DFY_ORDERS,
      },
      { status: 403 },
    )
  }

  const dfyOrderId = reservationId as string

  // --- (2) Provider call (real charge) ---
  let result
  try {
    result = await provider.createDfyOrder({ orderType, items, simulate: false })
  } catch (err) {
    // Provider call threw — mark reservation as failed. The slot stays consumed
    // by design: if the provider actually placed the order despite the thrown
    // error (false negative), we still have a row pointing at the cost. Better
    // to consume a slot than to lose track of money spent.
    const msg = err instanceof Error ? err.message : 'unknown'
    console.error('[dfy-order:real] provider call threw', { dfy_order_id: dfyOrderId, error: msg })
    await admin.from('dfy_orders')
      .update({ status: 'failed', error_reason: `provider_call_threw: ${msg}` })
      .eq('id', dfyOrderId)
    return NextResponse.json(
      { error: 'Could not place order', message: msg, dfy_order_id: dfyOrderId },
      { status: 502 },
    )
  }

  // Provider responded but rejected the order (validation buckets non-empty).
  // No charge was made on their side. We still mark the reservation failed so
  // the cap reflects the attempt — same reasoning as above (safer over-counting
  // than under-counting on a money-spending path).
  if (!result.orderPlaced || !result.orderIsValid) {
    console.warn('[dfy-order:real] provider rejected order', {
      dfy_order_id: dfyOrderId,
      orderPlaced:  result.orderPlaced,
      orderIsValid: result.orderIsValid,
      orderError:   result.orderError,
    })
    await admin.from('dfy_orders')
      .update({ status: 'failed', error_reason: result.orderError ?? 'provider_rejected_order' })
      .eq('id', dfyOrderId)
    return NextResponse.json(
      {
        error: 'order_not_placed',
        orderError: result.orderError,
        unavailableDomains:       result.unavailableDomains,
        blacklistDomains:         result.blacklistDomains,
        invalidDomains:           result.invalidDomains,
        invalidForwardingDomains: result.invalidForwardingDomains,
        domainsWithoutAccounts:   result.domainsWithoutAccounts,
        message: 'The provider did not accept this order. See the buckets above for the reason.',
        dfy_order_id: dfyOrderId,
      },
      { status: 422 },
    )
  }

  // --- (3) Provider success — finalize reservation with provider id + totals ---
  const providerOrderId = extractProviderOrderId(result.raw)

  const { data: finalized, error: updateErr } = await admin
    .from('dfy_orders')
    .update({
      provider_order_id:     providerOrderId,
      total_price:           result.totalPrice,
      total_price_per_month: result.totalPricePerMonth,
      total_price_per_year:  result.totalPricePerYear,
      // status remains 'pending' until the reconcile cron flips it to 'completed'
    })
    .eq('id', dfyOrderId)
    .select('id, status, placed_at, total_price')
    .single()

  if (updateErr || !finalized) {
    // Order was placed at the provider AND the reservation row exists, but we
    // couldn't decorate it with the provider_order_id. The cron's heuristic
    // matching (by item content + placed_at) will still pick it up; log loudly
    // so an operator can sanity-check.
    console.error('[dfy-order:real] CRITICAL: finalize update failed after provider success', {
      dfy_order_id:      dfyOrderId,
      provider_order_id: providerOrderId,
      workspace_id:      workspaceId,
      user_id:           user.id,
      error:             updateErr,
    })
    return NextResponse.json(
      {
        error: 'order_placed_but_not_finalized',
        message: 'Your order was placed and reserved but we could not store the provider id. Support has been notified.',
        dfy_order_id:      dfyOrderId,
        provider_order_id: providerOrderId,
      },
      { status: 500 },
    )
  }

  console.log(JSON.stringify({
    event:             'dfy_real_order_placed',
    workspace_id:      workspaceId,
    user_id:           user.id,
    dfy_order_id:      finalized.id,
    provider_order_id: providerOrderId,
    total_price:       result.totalPrice,
    timestamp:         new Date().toISOString(),
  }))

  return NextResponse.json(
    {
      dfy_order_id:      finalized.id,
      status:            finalized.status,
      total_price:       finalized.total_price,
      provider_order_id: providerOrderId,
      placed_at:         finalized.placed_at,
    },
    { status: 201 },
  )
}

// The provider response shape we observed during simulation didn't surface an
// order id — we extract optimistically from common field names. When null, the
// reconcile cron matches by item content + placed_at heuristic.
function extractProviderOrderId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const candidates = ['id', 'order_id', 'order_uuid']
  for (const k of candidates) {
    const v = r[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}
