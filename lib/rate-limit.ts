import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'
import { NextResponse } from 'next/server'
import { getIp } from './get-ip'

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

export type RateLimitWindow = `${number} ${'s' | 'm' | 'h'}`

export type RateLimitConfig = {
  limit:  number
  window: RateLimitWindow
  prefix: string
}

const limiters = new Map<string, Ratelimit>()

function getLimiter(config: RateLimitConfig): Ratelimit {
  if (!limiters.has(config.prefix)) {
    limiters.set(config.prefix, new Ratelimit({
      redis,
      limiter:   Ratelimit.slidingWindow(config.limit, config.window),
      prefix:    `rl:${config.prefix}`,
      analytics: false,
    }))
  }
  return limiters.get(config.prefix)!
}

type RateLimitResult =
  | { allowed: true }
  | { allowed: false; response: NextResponse }

function buildLimitedResponse(reset: number): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
  return NextResponse.json(
    { error: 'Rate limited', retry_after_seconds: retryAfter },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  )
}

export async function rateLimitByIp(
  request: Request,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const ip = getIp(request)
  const { success, reset } = await getLimiter(config).limit(ip)
  if (success) return { allowed: true }
  return { allowed: false, response: buildLimitedResponse(reset) }
}

export async function rateLimitByWorkspace(
  workspaceId: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const { success, reset } = await getLimiter(config).limit(workspaceId)
  if (success) return { allowed: true }
  return { allowed: false, response: buildLimitedResponse(reset) }
}

/**
 * Rate limit keyed by user id. Used for per-user protections where the
 * cost is billed to Anthropic on a per-message basis regardless of the
 * workspace (bot conversations). Same sliding-window backing store as
 * rateLimitByWorkspace — only the key differs.
 */
export async function rateLimitByUser(
  userId: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const { success, reset } = await getLimiter(config).limit(userId)
  if (success) return { allowed: true }
  return { allowed: false, response: buildLimitedResponse(reset) }
}
