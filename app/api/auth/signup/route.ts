import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, createChunks, DEFAULT_COOKIE_OPTIONS } from '@supabase/ssr'
import { signupSchema } from '@/lib/schemas'
import { rateLimitByIp } from '@/lib/rate-limit'
import { verifyTurnstile } from '@/lib/turnstile'
import { getAdminSetting } from '@/lib/admin-settings'

export async function POST(request: NextRequest) {
  const rl = await rateLimitByIp(request, { limit: 5, window: '10 m', prefix: 'auth-signup' })
  if (!rl.allowed) return rl.response

  // D2 lot 2 — signups_enabled kill switch. Defensive default: only block
  // when the flag is EXPLICITLY set to false. A missing row (fresh install,
  // accidental deletion, DB probe failure) leaves signups open — the seed
  // in migration 035 initialises this to true, so blocking on absence
  // would be a foot-gun that silently disables all sign-ups.
  const signupsFlag = await getAdminSetting<boolean>('signups_enabled')
  if (signupsFlag === false) {
    return NextResponse.json(
      { success: false, error: 'signups_disabled', message: 'New signups are temporarily paused. Please try again later.' },
      { status: 403 },
    )
  }

  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const parsed = signupSchema.safeParse(rawBody)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_payload', issues: parsed.error.issues }, { status: 400 })

  const { email, password, name, workspaceName, companyName, product, icp, tone, plan_tier, captchaToken } = parsed.data

  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
                || request.headers.get('x-real-ip')
                || undefined
  const captchaResult = await verifyTurnstile(captchaToken, clientIp)
  if (!captchaResult.success) {
    console.warn('[signup] CAPTCHA verification failed:', captchaResult.errorCodes)
    return NextResponse.json(
      { error: 'captcha_failed', errorCodes: captchaResult.errorCodes },
      { status: 400 }
    )
  }

  const tier = plan_tier ?? 'power'

  const admin = createAdminClient()
  const cookieJar: Record<string, { name: string; value: string; options: any }> = {}

  // @supabase/ssr@0.1.0 uses get/set/remove (not getAll/setAll). cookieJar accumulates
  // Set-Cookie entries; respond() flushes them onto the NextResponse.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return request.cookies.get(name)?.value },
        set(name: string, value: string, options: any) { cookieJar[name] = { name, value, options } },
        remove(name: string, options: any) { delete cookieJar[name] }
      }
    }
  )

  function respond(body: object, status = 200) {
    const res = NextResponse.json(body, { status })
    Object.values(cookieJar).forEach(({ name, value, options }) => res.cookies.set(name, value, options))
    // Fresh workspaces get workspace_profiles.language default 'en' (baseline
    // L1278). Pin the dashboard locale cookie to 'en' so the first dashboard
    // render post-signup does not fall back to the client default synchronously
    // and then need a reload. Non-httpOnly: client reads at mount.
    res.cookies.set('mirvo_dashboard_locale', 'en', {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
    return res
  }

  const { data: signupData, error: signupError } = await supabase.auth.signUp({
    email, password, options: { data: { full_name: name } }
  })
  if (signupError) {
    const isExisting =
      signupError.message?.toLowerCase().includes('already registered') ||
      signupError.message?.toLowerCase().includes('already exists') ||
      (signupError as any).code === 'user_already_exists'
    if (isExisting) {
      const recovery = await detectPurgedAccount(admin, email)
      return respond(
        recovery
          ? { success: false, error: 'email_exists_purged', message: 'Your account still exists, but your workspace was removed. Log in to start fresh.' }
          : { success: false, error: 'email_exists',        message: 'An account with this email already exists. Please sign in instead.' },
        400
      )
    }
    return respond({ success: false, error: 'signup_failed', message: signupError.message }, 400)
  }
  if (!signupData.user || signupData.user.identities?.length === 0) {
    const recovery = await detectPurgedAccount(admin, email)
    return respond(
      recovery
        ? { success: false, error: 'email_exists_purged', message: 'Your account still exists, but your workspace was removed. Log in to start fresh.' }
        : { success: false, error: 'email_exists',        message: 'An account with this email already exists. Please sign in instead.' },
      400
    )
  }

  await admin.auth.admin.updateUserById(signupData.user.id, { email_confirm: true })

  const { error: loginError, data: signInData } = await supabase.auth.signInWithPassword({ email, password })
  if (loginError) return respond({ error: loginError.message }, 400)

  // signInWithPassword's async _persistSession fires after respond() — force-write
  // session cookies into the jar now so they are present in the response.
  if (signInData.session) {
    const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL!.split('//')[1].split('.')[0]
    const cookieKey = `sb-${projectRef}-auth-token`
    const chunks = createChunks(cookieKey, JSON.stringify(signInData.session))
    chunks.forEach(({ name, value }) => {
      cookieJar[name] = { name, value, options: { ...DEFAULT_COOKIE_OPTIONS } }
    })
  }

  const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.random().toString(36).slice(2, 6)
  const now       = new Date()
  const trialEnd  = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

  const { data: workspace, error: wsError } = await admin
    .from('workspaces')
    .insert({
      name:                workspaceName,
      slug,
      plan:                'trial',
      plan_tier:           tier,
      subscription_status: 'trialing',
      trial_start_date:    now.toISOString(),
      trial_end_date:      trialEnd.toISOString(),
    })
    .select().single()

  if (wsError || !workspace) {
    if (wsError?.message?.includes('plan_tier') || wsError?.message?.includes('subscription_status') || wsError?.message?.includes('trial_end_date')) {
      console.error('[signup] Migration 004 (stripe_subscriptions) may not have run — schema column missing:', wsError.message)
    } else {
      console.error('[signup] workspace insert error:', wsError?.message)
    }
    return respond({ error: 'Failed to create workspace. Please contact support.' }, 500)
  }

  // D4 lot A — members INSERT check + rollback. Without the .error check,
  // a failed member insert silently orphaned the workspace (invisible via
  // RLS since SELECT policies require a workspace_members link) while the
  // route still returned success:true. Cleanup DELETE is scoped to
  // workspace.id — the row was just created and has no other members yet,
  // so no race with concurrent writes is possible.
  const { error: memberError } = await admin.from('workspace_members').insert({
    workspace_id: workspace.id, user_id: signupData.user.id, role: 'owner', invite_accepted: true
  })
  if (memberError) {
    console.error('[signup] workspace_members insert failed, rolling back workspace:', memberError.message)
    await admin.from('workspaces').delete().eq('id', workspace.id)
    return respond({ success: false, error: 'signup_incomplete', message: 'Failed to complete signup. Please try again.' }, 500)
  }

  // booking_slug: firstname-xxxx (4 random alphanum). Collision chance is negligible at this scale.
  const firstName = name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'user'
  const bookingSlug = `${firstName}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 30)

  // D4 lot A — profiles INSERT check, NON-FATAL. Missing profile degrades
  // features that read it (bot context, campaign LLM, morning brief,
  // sender identity) into placeholder mode — recoverable via a later
  // settings save. Never roll back workspace+member for this. TODO D4.1:
  // lazy-create workspace_profiles on first read when the row is missing.
  const { error: profileError } = await admin.from('workspace_profiles').insert({
    workspace_id: workspace.id, company_name: companyName, product_description: product,
    icp_description: icp, tone, onboarding_completed: true, booking_slug: bookingSlug,
  })
  if (profileError) {
    console.error('[signup] workspace_profiles insert failed (non-fatal, profile can be created later):', profileError.message)
  }

  return respond({ success: true })
}

// Given a signup attempt on an already-registered email, detect whether the
// account is in the "purged workspace" state (auth.users row still there, zero
// workspace_members rows) — the post-J+30-purge shape produced by
// /api/cron/purge-canceled-workspaces. Returns true only when we're confident.
//
// Cost: one admin.auth.admin.listUsers() page + one workspace_members SELECT.
// Supabase JS caps perPage at 200 with no email-filter support, so we scan
// pages until we find the row or hit MAX_PAGES. The signup endpoint is rate-
// limited to 5/10 min per IP (line 9), so scan cost is bounded per attacker.
// If the user base grows past MAX_PAGES × 200 = 2000 users, migrate to a
// dedicated RPC (auth.users is not accessible via the .from() interface).
//
// Never throws. On any failure the return is false, which surfaces the
// original generic "sign in instead" message — the recovery message is a UX
// enhancement, not a correctness contract.
async function detectPurgedAccount(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<boolean> {
  const MAX_PAGES = 10
  const PER_PAGE  = 200
  const target    = email.trim().toLowerCase()
  try {
    let userId: string | null = null
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE })
      if (error || !data) return false
      const match = data.users.find((u) => (u.email ?? '').toLowerCase() === target)
      if (match) { userId = match.id; break }
      if (data.users.length < PER_PAGE) break
    }
    if (!userId) return false
    const { data: rows, error: memberErr } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)
      .limit(1)
    if (memberErr) return false
    return (rows?.length ?? 0) === 0
  } catch {
    return false
  }
}
