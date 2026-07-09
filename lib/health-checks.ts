import { createAdminClient } from '@/lib/supabase/admin'
import Stripe from 'stripe'
import { getEmailProviderDiagnostic } from '@/lib/email-provider-health'

const CHECK_TIMEOUT_MS = 3000

export type CheckStatus = 'ok' | 'degraded' | 'down'
export type CheckResult = {
  status: CheckStatus
  latency_ms?: number
  error?: string
}
export type HealthResponse = {
  status: CheckStatus
  timestamp: string
  checks: {
    database:                   CheckResult
    stripe:                     CheckResult
    stripe_webhook:             CheckResult
    anthropic:                  CheckResult
    resend:                     CheckResult
    instantly_provider:         CheckResult
    instantly_webhook:          CheckResult
    instantly_webhook_activity: CheckResult
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ])
}

async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now()
  try {
    const admin = createAdminClient()
    await withTimeout(
      (async () => {
        const { error } = await admin.from('workspaces').select('id').limit(1)
        if (error) throw new Error(error.message)
      })(),
      CHECK_TIMEOUT_MS
    )
    return { status: 'ok', latency_ms: Date.now() - start }
  } catch (err) {
    return { status: 'down', error: err instanceof Error ? err.message : 'Unknown' }
  }
}

async function checkStripe(): Promise<CheckResult> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { status: 'degraded', error: 'STRIPE_SECRET_KEY not set' }
  }
  const start = Date.now()
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' as Stripe.LatestApiVersion })
    await withTimeout(stripe.products.list({ limit: 1 }), CHECK_TIMEOUT_MS)
    return { status: 'ok', latency_ms: Date.now() - start }
  } catch (err) {
    return { status: 'down', error: err instanceof Error ? err.message : 'Unknown' }
  }
}

// Sprint B3 — presence check only. If STRIPE_WEBHOOK_SECRET is missing, every
// event from Stripe fails the constructEvent HMAC check and is rejected 400
// silently; the workspace stays at subscription_status='trialing' after a
// successful payment. The response error message names the env var only —
// the value is never read out.
function checkStripeWebhook(): CheckResult {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return { status: 'degraded', error: 'STRIPE_WEBHOOK_SECRET not set' }
  }
  return { status: 'ok' }
}

function checkAnthropic(): CheckResult {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { status: 'degraded', error: 'ANTHROPIC_API_KEY not set' }
  }
  return { status: 'ok' }
}

function checkResend(): CheckResult {
  if (!process.env.RESEND_API_KEY) {
    return { status: 'degraded', error: 'RESEND_API_KEY not set' }
  }
  return { status: 'ok' }
}

// Sprint B1 — reports the running email provider using the shared diagnostic
// helper. Degraded when the app fell back to MockEmailProvider (either because
// MOCK_EMAIL_PROVIDER=true or because INSTANTLY_API_KEY is missing); prod
// silently sends via mock in that state. The error message contains only the
// env-var-name reason from the fixed enum, never the API key value.
function checkInstantlyProvider(): CheckResult {
  const d = getEmailProviderDiagnostic()
  if (d.isMock) {
    return { status: 'degraded', error: `email provider is in MOCK mode: ${d.reason}` }
  }
  return { status: 'ok' }
}

// Sprint B1 — presence check. Missing INSTANTLY_WEBHOOK_SECRET makes every
// Instantly webhook (REPLY, SENT, BOUNCED, etc.) fail HMAC verification and
// return 500 to Instantly; nothing lands in inbox_messages, users see zero
// replies. Value never read.
function checkInstantlyWebhook(): CheckResult {
  if (!process.env.INSTANTLY_WEBHOOK_SECRET) {
    return { status: 'degraded', error: 'INSTANTLY_WEBHOOK_SECRET not set' }
  }
  return { status: 'ok' }
}

// Sprint B4 — detects the "Instantly webhook silence" outage: the app is
// producing send activity (users approve emails, which triggers Instantly
// ensureCampaign/enqueueLead/activateCampaign within seconds) but no webhook
// has been received in > 48h. Almost certainly means the webhook URL is not
// registered in the Instantly dashboard, so REPLY/SENT/BOUNCED events never
// come back — replies vanish silently to the user.
//
// Activity signal is prospect_emails.status='approved' + approved_at within
// the last 24h — NOT email_send_log (which is populated BY the SENT webhook
// itself, so a silent webhook would starve that signal and cause a permanent
// false negative). Approvals are user-driven and land on the DB regardless
// of the webhook state.
//
// Query pair uses idx_webhook_events_provider_type (migration 061). No
// user input in either query — all values are constants defined above.
// Error strings surface only counts, table names, and durations. Never PII
// (no email addresses, no workspace ids), never any secret.
const INSTANTLY_ACTIVITY_WINDOW_HOURS   = 24
const INSTANTLY_SILENCE_THRESHOLD_HOURS = 48

async function checkInstantlyWebhookActivity(): Promise<CheckResult> {
  try {
    const admin = createAdminClient()
    const activitySince = new Date(
      Date.now() - INSTANTLY_ACTIVITY_WINDOW_HOURS * 3600_000,
    ).toISOString()

    // 1) Is anything happening that should trigger a webhook?
    // Dropped `head: true` intentionally: with HEAD, PostgREST returns no body
    // on a 4xx, supabase-js falls back to `{ message: '' }`, and any future
    // schema drift surfaces as `activity probe failed: ` (opaque). Fetching
    // one row is cheap and keeps error messages readable in the daily alert.
    const { count: recentApprovals, error: activityErr } = await admin
      .from('prospect_emails')
      .select('id', { count: 'exact' })
      .eq('status', 'approved')
      .gte('approved_at', activitySince)
      .limit(1)
    if (activityErr) {
      const msg = activityErr.message || activityErr.code || 'unknown supabase error'
      return { status: 'down', error: `activity probe failed: ${msg}` }
    }
    const approvals = recentApprovals ?? 0
    if (approvals === 0) {
      // No send activity in the window → nothing to check.
      return { status: 'ok' }
    }

    // 2) When was the last Instantly webhook received (any workspace, any type)?
    const { data: lastEvent, error: lastErr } = await admin
      .from('webhook_events')
      .select('received_at')
      .eq('provider', 'instantly')
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastErr) {
      return { status: 'down', error: `webhook probe failed: ${lastErr.message}` }
    }

    const lastAt     = lastEvent?.received_at ? new Date(lastEvent.received_at).getTime() : 0
    const hoursSince = lastAt > 0 ? (Date.now() - lastAt) / 3600_000 : Infinity

    if (hoursSince > INSTANTLY_SILENCE_THRESHOLD_HOURS) {
      const detail = lastAt > 0
        ? `last Instantly webhook was ${Math.round(hoursSince)}h ago (threshold ${INSTANTLY_SILENCE_THRESHOLD_HOURS}h), but ${approvals} approvals in the last ${INSTANTLY_ACTIVITY_WINDOW_HOURS}h`
        : `no Instantly webhook ever received, but ${approvals} approvals in the last ${INSTANTLY_ACTIVITY_WINDOW_HOURS}h — is the webhook URL configured in the Instantly dashboard?`
      return { status: 'degraded', error: detail }
    }

    return { status: 'ok' }
  } catch (err) {
    return { status: 'down', error: err instanceof Error ? err.message : 'Unknown' }
  }
}

export async function runHealthChecks(): Promise<HealthResponse> {
  const [database, stripe, instantly_webhook_activity] = await Promise.all([
    checkDatabase(),
    checkStripe(),
    checkInstantlyWebhookActivity(),
  ])
  const stripe_webhook     = checkStripeWebhook()
  const anthropic          = checkAnthropic()
  const resend             = checkResend()
  const instantly_provider = checkInstantlyProvider()
  const instantly_webhook  = checkInstantlyWebhook()

  const allStatuses: CheckStatus[] = [
    database.status,
    stripe.status,
    stripe_webhook.status,
    anthropic.status,
    resend.status,
    instantly_provider.status,
    instantly_webhook.status,
    instantly_webhook_activity.status,
  ]
  let overall: CheckStatus = 'ok'
  if (allStatuses.includes('down'))          overall = 'down'
  else if (allStatuses.includes('degraded')) overall = 'degraded'

  return {
    status: overall,
    timestamp: new Date().toISOString(),
    checks: {
      database,
      stripe,
      stripe_webhook,
      anthropic,
      resend,
      instantly_provider,
      instantly_webhook,
      instantly_webhook_activity,
    },
  }
}
