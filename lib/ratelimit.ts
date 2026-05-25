import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const redis = Redis.fromEnv()

// Per-IP global (catch-all) : 60 req / min
export const globalRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, '1 m'),
  analytics: true,
  prefix: 'sentra:rl:global',
})

// Per-IP write endpoints (POST/PATCH/PUT/DELETE) : 30 req / min
export const writeRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 m'),
  analytics: true,
  prefix: 'sentra:rl:write',
})

// Per-workspace AI endpoints : 50 req / min (protects Claude tokens)
export const aiRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(50, '1 m'),
  analytics: true,
  prefix: 'sentra:rl:ai',
})

export type AiRateCheck =
  | { allowed: true }
  | { allowed: false; remaining: number; resetMs: number }

export async function checkAiRateLimit(workspaceId: string): Promise<AiRateCheck> {
  const result = await aiRateLimit.limit(workspaceId)
  if (result.success) return { allowed: true }
  return {
    allowed: false,
    remaining: result.remaining,
    resetMs: Math.max(0, result.reset - Date.now()),
  }
}
