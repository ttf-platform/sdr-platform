import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function POST(request: Request) {
  const { email, password, name, workspaceName, companyName, product, icp, tone } = await request.json()
  const cookieStore = cookies()
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
  const { data: signupData, error: signupError } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } })
  if (signupError) return NextResponse.json({ error: signupError.message }, { status: 400 })
  const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
  if (loginError) return NextResponse.json({ error: loginError.message }, { status: 400 })
  const admin = createAdminClient()
  const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.random().toString(36).slice(2, 6)
  const { data: workspace } = await admin.from('workspaces').insert({ name: workspaceName, slug, plan: 'trial' }).select().single()
  if (workspace && signupData.user) {
    await admin.from('workspace_members').insert({ workspace_id: workspace.id, user_id: signupData.user.id, role: 'owner', invite_accepted: true })
    await admin.from('workspace_profiles').insert({ workspace_id: workspace.id, company_name: companyName, product_description: product, icp_description: icp, tone, onboarding_completed: true })
  }
  return NextResponse.json({ success: true })
}