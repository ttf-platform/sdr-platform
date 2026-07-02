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
    database:           CheckResult
    stripe:             CheckResult
    stripe_webhook:     CheckResult
    anthropic:          CheckResult
    resend:             CheckResult
    instantly_provider: CheckResult
    instantly_webhook:  CheckResult
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

export async function runHealthChecks(): Promise<HealthResponse> {
  const [database, stripe] = await Promise.all([checkDatabase(), checkStripe()])
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
    },
  }
}
