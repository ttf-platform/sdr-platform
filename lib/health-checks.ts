import { createAdminClient } from '@/lib/supabase/admin'
import Stripe from 'stripe'
import { getEmailProviderDiagnostic } from '@/lib/email-provider-health'
import { COMMITTED_STATUSES } from '@/lib/prospect-email-status'

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
    // Stay 'degraded' either way — a mock provider is never a healthy
    // production state. Passing 'down' would flip /api/health to 503 on
    // every request in staging, which is not the goal of ALLOW_MOCK_SEND.
    // Note : lib/health-alert already alerts on 'degraded', so the daily
    // alert fires regardless of this branch — see health-alert/route.ts:60.
    if (d.mockSendAllowed) {
      return {
        status: 'degraded',
        error:  'email provider is in MOCK mode with ALLOW_MOCK_SEND=true — sends are simulated, nothing goes out',
      }
    }
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

// Sprint B4, repaired by lot INFRA.5 — detects the provider "webhook silence"
// outage: the app handed emails to the sending provider but no webhook came
// back. Replies then vanish silently: the inbox has a single source and no
// replay, so a silence window is a permanent data hole.
//
// ACTIVITY SIGNAL — prospect_emails whose status is in COMMITTED_STATUSES,
// with approved_at inside the window. Read this before touching it:
//   * COMMITTED_STATUSES is imported, never redeclared. Its owner module
//     defines it as "handed off to the sending provider", which is exactly
//     the question this probe asks. A local copy would drift, the way the
//     approve route's own allowlist once did.
//   * NOT status='approved'. That is a PARKING state — a variant converged
//     into prospect_emails and NOT yet shipped. Its only writers are in
//     app/api/prospect-email-variants/[id]/route.ts, which never calls the
//     provider. Counting it produced BOTH failure modes at once: the nominal
//     draft -> approve -> 'sending' path never sits in 'approved' (probe
//     stayed green through any outage), while staged-but-unsent variants
//     triggered it with no event ever due.
//   * NOT email_send_log — populated BY the SENT webhook itself, so a silent
//     webhook starves that signal: a permanent false negative.
//   * approved_at is rewritten by the CAS reservation at hand-off time, so
//     on a committed row it IS the hand-off timestamp.
//
// THRESHOLD — 72h, not 48h. The default sending calendar is Mon-Fri
// (lib/types/sending-prefs.ts), so the normal weekend gap reaches ~63h and
// 48h alerted on it every week. WHAT 72h DOES NOT BUY: sendDays is user
// configurable, and a narrower calendar still leaves a longer legitimate
// gap. This reduces the false-positive class, it does not close it.
//
// DETECTION DELAY, published with its scope — the probe flips past 72h, but
// the only consumer that notifies is the daily 08:00 UTC health-alert cron,
// so real notification lands anywhere in 72h..96h, and only on days where a
// hand-off happened inside the activity window. `degraded` also returns HTTP
// 200, so an external uptime monitor cannot alert on it.
//
// ERROR STRINGS — vendor-neutral, and they carry no counter. /api/health is
// public, unauthenticated and rate-limit exempt (middleware.ts). This is a
// NON-AGGRAVATION measure only: it stops this probe from ADDING a vendor
// name and a cross-tenant volume to that surface. It does NOT close vendor
// invisibility there — the response keys and two sibling checks still name
// providers. That residue belongs to TD-138, not here.
//
// Neither query takes user input; all values are constants defined above.
// Never PII (no email addresses, no workspace ids), never any secret.
// The second query is served by idx_webhook_events_provider_type on its
// `provider` prefix only — event_type is not constrained here, so ordering
// is not index-served. Neither query filters workspace_id: both are
// deliberately cross-tenant, this is an operator-level probe.
const INSTANTLY_ACTIVITY_WINDOW_HOURS   = 24
const INSTANTLY_SILENCE_THRESHOLD_HOURS = 72

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
      .in('status', [...COMMITTED_STATUSES])
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
        ? `last provider webhook was ${Math.floor(hoursSince)}h ago (threshold ${INSTANTLY_SILENCE_THRESHOLD_HOURS}h) while send activity is present`
        : `no provider webhook ever received while send activity is present — check the webhook URL registered with the provider`
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
