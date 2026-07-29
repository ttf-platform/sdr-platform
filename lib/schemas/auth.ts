import { z } from 'zod'
import { ianaSchema } from './booking'

// First-touch acquisition record. Optional at the schema level (a signup
// with cookies rejected or empty localStorage sends nothing), but when
// present it is strictly shaped: known keys only, each capped at 200 chars
// (255 for referrer to accommodate long hostnames), unknown keys silently
// stripped by .strip(). The whole object is written verbatim into
// workspaces.acquisition (jsonb) at workspace creation; never overwritten.
export const acquisitionSchema = z.object({
  utm_source:   z.string().max(200).optional(),
  utm_medium:   z.string().max(200).optional(),
  utm_campaign: z.string().max(200).optional(),
  utm_term:     z.string().max(200).optional(),
  utm_content:  z.string().max(200).optional(),
  referrer:     z.string().max(255).optional(),
}).strip()

export const signupSchema = z.object({
  email:         z.string().email().max(254),
  password:      z.string().min(8).max(72),
  name:          z.string().min(1).max(100),
  companyName:   z.string().min(1).max(200),
  plan_tier:     z.enum(['starter', 'pro', 'power']).optional(),
  captchaToken:  z.string().min(1, 'captcha_required'),
  acquisition:   acquisitionSchema.optional(),
  // First-touch UI locale captured on the landing page (from useLocale()).
  // Falls back to the NEXT_LOCALE cookie server-side when absent, then to
  // 'en'. Persisted to workspace_profiles.language + mirvo_dashboard_locale
  // cookie so a FR visitor lands on a FR dashboard post-signup.
  locale:        z.enum(['en', 'fr']).optional(),
  // Detected IANA timezone from the browser (see lib/timezones.detectClientTimezone).
  // .catch(undefined) is DELIBERATE and load-bearing : signup/route.ts:31-32
  // runs safeParse and returns 400 on any zod failure. A tz value that
  // reaches us malformed (spoofed body, stale localStorage, unusual browser)
  // MUST NOT gate account creation — the whole flow is designed so the DB
  // DEFAULT ('America/Toronto', 000_baseline.sql:1285) applies when nothing
  // valid arrives. `.optional()` alone would only handle the ABSENT case ;
  // a present-but-invalid value would still trip the refine + 400 the
  // account. `.catch(undefined)` collapses BOTH cases to undefined, and
  // the route treats undefined as "no override, keep DEFAULT".
  timezone:      ianaSchema.optional().catch(undefined),
})

export const loginSchema = z.object({
  email:    z.string().email().max(254),
  password: z.string().min(1).max(72),
})
