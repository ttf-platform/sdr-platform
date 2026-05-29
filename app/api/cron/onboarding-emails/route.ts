import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendOnboardingEmail, type OnboardingDayOffset } from '@/lib/email'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 60

const DAY_OFFSETS: OnboardingDayOffset[] = [0, 2, 4, 7]

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Misconfigured: CRON_SECRET not set' }, { status: 500 })
  }
  const authHeader = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const provided = Buffer.from(authHeader)
  const expectedBuf = Buffer.from(expected)
  const valid = provided.length === expectedBuf.length && timingSafeEqual(provided, expectedBuf)
  if (!valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supa = createAdminClient()
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'
  const summary = {
    processed: 0,
    sent: 0,
    skipped: 0,
    errors: [] as string[],
  }

  // 1. All workspaces with their owner (via workspace_members role='owner')
  const { data: workspaces, error: wsErr } = await supa
    .from('workspaces')
    .select('id, name, subscription_status, workspace_members!inner(user_id, role)')
    .eq('workspace_members.role', 'owner')

  if (wsErr || !workspaces) {
    return NextResponse.json({ error: wsErr?.message ?? 'failed to fetch workspaces' }, { status: 500 })
  }

  // 2. All auth users via admin SDK (service role)
  const { data: { users: authUsers }, error: usersErr } = await supa.auth.admin.listUsers({ perPage: 1000 })

  if (usersErr) {
    return NextResponse.json({ error: usersErr.message ?? 'failed to fetch auth users' }, { status: 500 })
  }

  const userMap = new Map<string, { email: string; createdAt: Date; firstName: string | null }>(
    authUsers.map((u) => [
      u.id,
      {
        email: u.email ?? '',
        createdAt: new Date(u.created_at),
        firstName: (u.user_metadata?.first_name as string | null) ?? null,
      },
    ])
  )

  // 3. Already-sent idempotency set — fail-closed if table missing
  const { data: sentRows, error: sentErr } = await supa
    .from('onboarding_emails')
    .select('workspace_id, day_offset')

  if (sentErr) {
    return NextResponse.json({ error: `Failed to query idempotency table: ${sentErr.message}` }, { status: 500 })
  }

  const sentSet = new Set<string>(
    (sentRows ?? []).map((r: { workspace_id: string; day_offset: number }) => `${r.workspace_id}:${r.day_offset}`)
  )

  const now = Date.now()

  for (const ws of workspaces) {
    const members = ws.workspace_members as { user_id: string; role: string }[] | null
    const ownerUserId = members?.[0]?.user_id
    if (!ownerUserId) continue
    const user = userMap.get(ownerUserId)
    if (!user?.email) continue

    const daysSinceSignup = Math.floor((now - user.createdAt.getTime()) / (86_400 * 1_000))
    summary.processed++

    for (const offset of DAY_OFFSETS) {
      const key = `${ws.id}:${offset}`

      // Skip if already sent
      if (sentSet.has(key)) {
        summary.skipped++
        continue
      }

      // Day 2/4/7 skipped for active subscribers (already converted)
      if (offset > 0 && ws.subscription_status === 'active') {
        summary.skipped++
        continue
      }

      // Tolerance: send if today is the target day or 1 day late
      if (daysSinceSignup < offset || daysSinceSignup > offset + 1) {
        summary.skipped++
        continue
      }

      const result = await sendOnboardingEmail({
        to: user.email,
        firstName: user.firstName,
        workspaceName: ws.name ?? 'your workspace',
        dayOffset: offset,
        appBaseUrl,
      })

      if (result.ok) {
        // Insert after successful send — retry on next run if insert fails
        await supa.from('onboarding_emails').insert({
          workspace_id: ws.id,
          day_offset: offset,
          resend_message_id: result.messageId ?? null,
        })
        console.log(JSON.stringify({
          cron: 'onboarding-emails',
          workspace_id: ws.id,
          day_offset: offset,
          status: 'sent',
          message_id: result.messageId,
        }))
        summary.sent++
        sentSet.add(key)
      } else {
        console.error(JSON.stringify({
          cron: 'onboarding-emails',
          workspace_id: ws.id,
          day_offset: offset,
          status: 'error',
          error: result.error,
        }))
        summary.errors.push(`ws=${ws.id} day=${offset}: ${result.error}`)
      }
    }
  }

  return NextResponse.json({ ...summary, timestamp: new Date().toISOString() })
}
