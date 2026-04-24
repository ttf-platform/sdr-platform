import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { createServerClient, createChunks, DEFAULT_COOKIE_OPTIONS } from '@supabase/ssr'

export async function POST(request: Request) {
  const { email, password, name, workspaceName, companyName, product, icp, tone } = await request.json()

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
    return res
  }

  const { data: signupData, error: signupError } = await supabase.auth.signUp({
    email, password, options: { data: { full_name: name } }
  })
  if (signupError) return respond({ error: signupError.message }, 400)
  if (!signupData.user || signupData.user.identities?.length === 0) {
    return respond({ error: 'An account with this email already exists.' }, 400)
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
  const { data: workspace, error: wsError } = await admin
    .from('workspaces')
    .insert({ name: workspaceName, slug, plan: 'trial' })
    .select().single()

  if (wsError || !workspace) return respond({ error: 'Failed to create workspace. Please contact support.' }, 500)

  await admin.from('workspace_members').insert({
    workspace_id: workspace.id, user_id: signupData.user.id, role: 'owner', invite_accepted: true
  })

  // booking_slug: firstname-xxxx (4 random alphanum). Collision chance is negligible at this scale.
  const firstName = name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'user'
  const bookingSlug = `${firstName}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 30)

  await admin.from('workspace_profiles').insert({
    workspace_id: workspace.id, company_name: companyName, product_description: product,
    icp_description: icp, tone, onboarding_completed: true, booking_slug: bookingSlug,
  })

  return respond({ success: true })
}
