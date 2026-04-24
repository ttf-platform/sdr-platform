import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function POST(request: Request) {
  const { email, password, name, workspaceName, companyName, product, icp, tone } = await request.json()
  const cookieStore = cookies()
  const admin = createAdminClient()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        }
      }
    }
  )

  const { data: signupData, error: signupError } = await supabase.auth.signUp({
    email, password, options: { data: { full_name: name } }
  })
  if (signupError) return NextResponse.json({ error: signupError.message }, { status: 400 })
  // Supabase returns identities: [] for existing emails instead of an error (anti-enumeration)
  if (!signupData.user || signupData.user.identities?.length === 0) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 400 })
  }

  await admin.auth.admin.updateUserById(signupData.user.id, { email_confirm: true })

  const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
  if (loginError) return NextResponse.json({ error: loginError.message }, { status: 400 })

  const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.random().toString(36).slice(2, 6)
  const { data: workspace, error: wsError } = await admin
    .from('workspaces')
    .insert({ name: workspaceName, slug, plan: 'trial' })
    .select().single()

  if (wsError || !workspace) {
    console.error('[signup] workspace creation failed for user', signupData.user.id, wsError)
    return NextResponse.json({ error: 'Failed to create workspace. Please contact support.' }, { status: 500 })
  }

  const { error: memberError } = await admin.from('workspace_members').insert({
    workspace_id: workspace.id,
    user_id: signupData.user.id,
    role: 'owner',
    invite_accepted: true
  })
  if (memberError) {
    console.error('[signup] workspace_members insert failed for user', signupData.user.id, memberError)
  }

  const { error: profileError } = await admin.from('workspace_profiles').insert({
    workspace_id: workspace.id,
    company_name: companyName,
    product_description: product,
    icp_description: icp,
    tone,
    onboarding_completed: true
  })
  if (profileError) {
    console.error('[signup] workspace_profiles insert failed for workspace', workspace.id, profileError)
  }

  return NextResponse.json({ success: true })
}
