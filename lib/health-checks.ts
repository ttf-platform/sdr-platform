import { createAdminClient } from '@/lib/supabase/admin'
import Stripe from 'stripe'

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
    database: CheckResult
    stripe: CheckResult
    anthropic: CheckResult
    resend: CheckResult
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
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' })
    await withTimeout(stripe.products.list({ limit: 1 }), CHECK_TIMEOUT_MS)
    return { status: 'ok', latency_ms: Date.now() - start }
  } catch (err) {
    return { status: 'down', error: err instanceof Error ? err.message : 'Unknown' }
  }
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

export async function runHealthChecks(): Promise<HealthResponse> {
  const [database, stripe] = await Promise.all([checkDatabase(), checkStripe()])
  const anthropic = checkAnthropic()
  const resend = checkResend()

  const allStatuses: CheckStatus[] = [database.status, stripe.status, anthropic.status, resend.status]
  let overall: CheckStatus = 'ok'
  if (allStatuses.includes('down')) overall = 'down'
  else if (allStatuses.includes('degraded')) overall = 'degraded'

  return {
    status: overall,
    timestamp: new Date().toISOString(),
    checks: { database, stripe, anthropic, resend },
  }
}
