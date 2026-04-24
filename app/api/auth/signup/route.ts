import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { createServerClient, createChunks, DEFAULT_COOKIE_OPTIONS } from '@supabase/ssr'

export async function POST(request: Request) {
  console.log('[SIGNUP] route hit')
  const { email, password, name, workspaceName, companyName, product, icp, tone } = await request.json()
  console.log('[SIGNUP] payload received for email:', email, '| workspaceName:', workspaceName)

  const admin = createAdminClient()
  const cookieJar: Record<string, { name: string; value: string; options: any }> = {}

  // @supabase/ssr@0.1.0 createServerClient uses cookies.get/set/remove (old API).
  // setAll is never triggered because setItem checks cookies.set which is undefined here.
  // We handle cookie persistence manually after signInWithPassword via cookieJar.
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
  console.log('[SIGNUP] signUp ok, user id:', signupData.user.id)

  console.log('[SIGNUP] calling auto-confirm...')
  const { error: confirmError } = await admin.auth.admin.updateUserById(signupData.user.id, { email_confirm: true })
  if (confirmError) {
    console.error('[SIGNUP] auto-confirm error:', confirmError.message)
  } else {
    console.log('[SIGNUP] auto-confirm ok')
  }

  console.log('[SIGNUP] calling signInWithPassword...')
  const { error: loginError, data: signInData } = await supabase.auth.signInWithPassword({ email, password })
  if (loginError) {
    console.error('[SIGNUP] signInWithPassword error:', loginError.message)
    return respond({ error: loginError.message }, 400)
  }
  console.log('[SIGNUP] signInWithPassword ok')

  // Manually serialize session into chunked cookies — createServerClient@0.1.0's setItem
  // uses cookies.set (old API) which is now provided above, but signInWithPassword
  // resolves synchronously before _persistSession fires its async storage.setItem.
  // Force-writing the session here guarantees cookies are in the jar before respond().
  if (signInData.session) {
    const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL!.split('//')[1].split('.')[0]
    const cookieKey = `sb-${projectRef}-auth-token`
    const chunks = createChunks(cookieKey, JSON.stringify(signInData.session))
    chunks.forEach(({ name, value }) => {
      cookieJar[name] = { name, value, options: { ...DEFAULT_COOKIE_OPTIONS } }
    })
    console.log('[SIGNUP] manually persisted session cookies:', chunks.map(c => c.name))
  }

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
