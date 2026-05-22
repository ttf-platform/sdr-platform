// lib/turnstile.ts
// Validates a Cloudflare Turnstile token via siteverify API.
// Called server-side from auth routes that require CAPTCHA protection.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export interface TurnstileVerifyResult {
  success: boolean
  errorCodes: string[]
}

export async function verifyTurnstile(token: string, ip?: string): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    console.error('[turnstile] TURNSTILE_SECRET_KEY not configured')
    return { success: false, errorCodes: ['missing-secret-key'] }
  }

  const body = new URLSearchParams({ secret, response: token })
  if (ip) body.append('remoteip', ip)

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const data = await res.json()
    return {
      success: data.success === true,
      errorCodes: data['error-codes'] || [],
    }
  } catch (err) {
    console.error('[turnstile] siteverify fetch failed:', err)
    return { success: false, errorCodes: ['internal-error'] }
  }
}
