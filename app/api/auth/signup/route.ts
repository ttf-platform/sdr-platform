import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function POST(request: Request) {
  console.log('[SIGNUP] route hit')
  const { email, password, name, workspaceName, companyName, product, icp, tone } = await request.json()
  console.log('[SIGNUP] payload received for email:', email, '| workspaceName:', workspaceName)

  const admin = createAdminClient()
  // cookieJar accumulates Set-Cookie values across multiple setAll calls (signUp + signInWithPassword)
  // and forwards them to the browser via explicit res.cookies.set() — required in Route Handlers
  // because next/headers cookieStore.set() does not propagate to the outgoing response
  const cookieJar: Record<string, { name: string; value: string; options: any }> = {}

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          console.log('[SIGNUP] setAll called with', cookiesToSet.map(c => c.name))
          cookiesToSet.forEach(c => { cookieJar[c.name] = c })
        }
      }
    }
  )

  function respond(body: object, status = 200) {
    const res = NextResponse.json(body, { status })
    Object.values(cookieJar).forEach(({ name, value, options }) => res.cookies.set(name, value, options))
    console.log('[SIGNUP] respond() attaching cookies:', Object.keys(cookieJar))
    return res
  }

  console.log('[SIGNUP] calling signUp...')
  const { data: signupData, error: signupError } = await supabase.auth.signUp({
    email, password, options: { data: { full_name: name } }
  })
  if (signupError) {
    console.error('[SIGNUP] signUp error:', signupError.message)
    return respond({ error: signupError.message }, 400)
  }
  if (!signupData.user || signupData.user.identities?.length === 0) {
    console.warn('[SIGNUP] existing email detected (identities empty), user:', signupData.user?.id)
    return respond({ error: 'An account with this email already exists.' }, 400)
  }
  console.log('[SIGNUP] signUp ok, user id:', signupData.user.id, '| email_confirmed_at:', signupData.user.email_confirmed_at)

  console.log('[SIGNUP] calling auto-confirm...')
  const { error: confirmError } = await admin.auth.admin.updateUserById(signupData.user.id, { email_confirm: true })
  if (confirmError) {
    console.error('[SIGNUP] auto-confirm error:', confirmError.message)
  } else {
    console.log('[SIGNUP] auto-confirm ok')
  }

  console.log('[SIGNUP] calling signInWithPassword...')
  const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
  if (loginError) {
    console.error('[SIGNUP] signInWithPassword error:', loginError.message)
    return respond({ error: loginError.message }, 400)
  }
  console.log('[SIGNUP] signInWithPassword ok')

  const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.random().toString(36).slice(2, 6)
  console.log('[SIGNUP] inserting workspace with slug:', slug)
  const { data: workspace, error: wsError } = await admin
    .from('workspaces')
    .insert({ name: workspaceName, slug, plan: 'trial' })
    .select().single()

  if (wsError || !workspace) {
    console.error('[SIGNUP] workspace insert failed for user', signupData.user.id, wsError)
    return respond({ error: 'Failed to create workspace. Please contact support.' }, 500)
  }
  console.log('[SIGNUP] workspace created, id:', workspace.id)

  const { error: memberError } = await admin.from('workspace_members').insert({
    workspace_id: workspace.id, user_id: signupData.user.id, role: 'owner', invite_accepted: true
  })
  if (memberError) {
    console.error('[SIGNUP] workspace_members insert failed for user', signupData.user.id, memberError)
  } else {
    console.log('[SIGNUP] workspace_members ok')
  }

  const { error: profileError } = await admin.from('workspace_profiles').insert({
    workspace_id: workspace.id, company_name: companyName, product_description: product,
    icp_description: icp, tone, onboarding_completed: true
  })
  if (profileError) {
    console.error('[SIGNUP] workspace_profiles insert failed for workspace', workspace.id, profileError)
  } else {
    console.log('[SIGNUP] workspace_profiles ok')
  }

  console.log('[SIGNUP] returning success')
  return respond({ success: true })
}
