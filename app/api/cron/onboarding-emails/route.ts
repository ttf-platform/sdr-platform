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

  // 1. All workspaces
  const { data: workspaces, error: wsErr } = await supa
    .from('workspaces')
    .select('id, name, owner_user_id, subscription_status')

  if (wsErr || !workspaces) {
    return NextResponse.json({ error: wsErr?.message ?? 'failed to fetch workspaces' }, { status: 500 })
  }

  // 2. All auth users (service role can access auth schema)
  const { data: usersData, error: usersErr } = await supa
    .schema('auth')
    .from('users')
    .select('id, email, created_at, raw_user_meta_data')

  if (usersErr || !usersData) {
    return NextResponse.json({ error: usersErr?.message ?? 'failed to fetch auth users' }, { status: 500 })
  }

  const userMap = new Map<string, { email: string; createdAt: Date; firstName: string | null }>(
    usersData.map((u: { id: string; email: string; created_at: string; raw_user_meta_data: Record<string, unknown> | null }) => [
      u.id,
      {
        email: u.email,
        createdAt: new Date(u.created_at),
        firstName: (u.raw_user_meta_data?.first_name as string | null) ?? null,
      },
    ])
  )

  // 3. Already-sent idempotency set
  const { data: sentRows } = await supa
    .from('onboarding_emails')
    .select('workspace_id, day_offset')

  const sentSet = new Set<string>(
    (sentRows ?? []).map((r: { workspace_id: string; day_offset: number }) => `${r.workspace_id}:${r.day_offset}`)
  )

  const now = Date.now()

  for (const ws of workspaces) {
    const user = userMap.get(ws.owner_user_id)
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
