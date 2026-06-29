import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronComplete } from '@/lib/cron-log'
import { scanSignalOnCampaign } from '@/lib/signal-scanner'
import { getResendClient } from '@/lib/email'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 300

const FROM_ADDRESS = 'Mirvo <onboarding@resend.dev>'
const AUTO_SCAN_PROSPECT_CAP = 10
const CRON_NAME = 'auto-scan-signals'

// GET /api/cron/auto-scan-signals
//
// Daily auto-scan: iterates all workspaces with active/trialing subscription,
// runs all their active signals against all non-archived campaigns.
// Email notification sent to workspace owner if new matches found.
// Fires at 5am UTC via Vercel cron.
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

  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  try {
    const admin = createAdminClient()
    const startTime = Date.now()
    const stats = {
      workspaces_processed: 0,
      signals_processed: 0,
      campaigns_processed: 0,
      total_matches_found: 0,
      notifications_sent: 0,
      errors: [] as string[],
    }

    // 1. All workspaces with active subscription
    const { data: workspaces, error: wsError } = await admin
      .from('workspaces')
      .select('id, plan_tier')
      .in('subscription_status', ['active', 'trialing'])

    if (wsError || !workspaces) {
      console.error('[cron/auto-scan-signals] failed to fetch workspaces:', wsError)
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 500,
        payload: { error: 'Failed to fetch workspaces' },
        started_at: startedAt,
        t0,
        error_message: wsError?.message ?? 'workspaces fetch failed',
      })
    }

    for (const workspace of workspaces) {
      stats.workspaces_processed++
      let workspaceNewMatches = 0
      const matchesByCampaign = new Map<string, { name: string; count: number }>()

      // Get active signals
      const { data: signals } = await admin
        .from('signals')
        .select('id, name')
        .eq('workspace_id', workspace.id)
        .eq('is_active', true)

      if (!signals || signals.length === 0) continue

      // Get all non-archived campaigns with at least the basic fields
      const { data: campaigns } = await admin
        .from('campaigns')
        .select('id, name, status')
        .eq('workspace_id', workspace.id)
        .neq('status', 'archived')

      if (!campaigns || campaigns.length === 0) continue

      // Run each signal × each campaign
      for (const signal of signals) {
        stats.signals_processed++

        for (const campaign of campaigns) {
          try {
            const result = await scanSignalOnCampaign({
              workspaceId: workspace.id,
              signalId: signal.id,
              campaignId: campaign.id,
              maxProspects: AUTO_SCAN_PROSPECT_CAP,
            })

            stats.campaigns_processed++

            if (result.matches_found > 0) {
              workspaceNewMatches += result.matches_found
              stats.total_matches_found += result.matches_found

              const existing = matchesByCampaign.get(campaign.id) ?? { name: campaign.name, count: 0 }
              existing.count += result.matches_found
              matchesByCampaign.set(campaign.id, existing)
            }
          } catch (err) {
            const msg = `ws=${workspace.id} sig=${signal.id} camp=${campaign.id}: ${err instanceof Error ? err.message : 'Unknown'}`
            console.error('[cron/auto-scan-signals]', msg)
            stats.errors.push(msg)
          }
        }
      }

      // 2. Email workspace owner if new matches found
      if (workspaceNewMatches > 0) {
        try {
          // Get owner user_id
          const { data: ownerMember } = await admin
            .from('workspace_members')
            .select('user_id')
            .eq('workspace_id', workspace.id)
            .eq('role', 'owner')
            .limit(1)
            .maybeSingle()

          if (ownerMember?.user_id) {
            // Get email from Supabase auth
            const { data: userResp } = await admin.auth.admin.getUserById(ownerMember.user_id)
            const ownerEmail = userResp?.user?.email

            if (ownerEmail) {
              const campaignLines = [...matchesByCampaign.values()]
                .map(c => `- ${c.name}: ${c.count} new match${c.count > 1 ? 'es' : ''}`)
                .join('\n')

              const resend = getResendClient()
              const sendResult = await resend.emails.send({
                from: FROM_ADDRESS,
                to: ownerEmail,
                subject: `${workspaceNewMatches} new signal match${workspaceNewMatches > 1 ? 'es' : ''} detected on Mirvo`,
                text: `Mirvo detected new signals on your campaigns overnight.\n\n${campaignLines}\n\nOpen the Approval Queue to generate personalized emails for these prospects:\nhttps://mirvo.ai/dashboard\n\n--\nMirvo background monitoring`,
              })
              if (sendResult.error) {
                const msg = `ws=${workspace.id} Resend rejected: ${sendResult.error.message ?? JSON.stringify(sendResult.error)}`
                console.error('[cron/auto-scan-signals]', msg)
                stats.errors.push(msg)
              } else {
                stats.notifications_sent++
              }
            }
          }
        } catch (err) {
          const msg = `ws=${workspace.id} email notif: ${err instanceof Error ? err.message : 'Unknown'}`
          console.error('[cron/auto-scan-signals]', msg)
          stats.errors.push(msg)
        }
      }
    }

    console.log('[cron/auto-scan-signals] complete', stats)
    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 200,
      payload: {
        duration_ms: Date.now() - startTime,
        ...stats,
      },
      started_at: startedAt,
      t0,
    })
  } catch (err) {
    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 500,
      payload: { error: 'unexpected_failure', detail: err instanceof Error ? err.message : 'unknown' },
      started_at: startedAt,
      t0,
      error_message: err instanceof Error ? err.message : 'unknown',
    })
  }
}
