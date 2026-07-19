import { createAdminClient } from '@/lib/supabase/admin'
import type { PlanTier } from '@/lib/stripe-prices'
import { triggerOverageChargeIfNeeded } from '@/lib/overage-charge'
import { getUsagePeriod } from '@/lib/billing-period'
import { notifyWorkspaceOwner, type LocalizedText } from '@/lib/notifications'

type TierKey = PlanTier | 'free'

export const TIER_CAPS: Record<TierKey, {
  total_prospects: number               // lifetime safety cap
  prospects_sourced_per_month: number   // AI prospect sourcing monthly cap (hard cap, no overage)
  enrichments_per_month: number         // enrichment monthly cap
  emails_per_month: number              // monthly email send cap
  inboxes: number
}> = {
  free:    { total_prospects: 1000,  prospects_sourced_per_month: 0,   enrichments_per_month: 25,  emails_per_month: 100,  inboxes: 1 },
  starter: { total_prospects: 10000, prospects_sourced_per_month: 120, enrichments_per_month: 100, emails_per_month: 1000, inboxes: 1 },
  pro:     { total_prospects: 25000, prospects_sourced_per_month: 250, enrichments_per_month: 300, emails_per_month: 2000, inboxes: 2 },
  power:   { total_prospects: 50000, prospects_sourced_per_month: 350, enrichments_per_month: 500, emails_per_month: 3000, inboxes: 3 },
}

type UsageMetric = 'enrichments_used' | 'prospects_sourced'

// Total contacts lifetime cap — counts from contacts table.
// Race condition under concurrent imports is an acceptable limitation.
export async function checkTotalProspectsLimit(
  workspaceId: string,
  amountToAdd: number,
): Promise<{ allowed: boolean; reason?: string; currentCount: number; cap: number }> {
  const admin = createAdminClient()

  const { data: ws } = await admin
    .from('workspaces').select('plan_tier')
    .eq('id', workspaceId).single()

  const tier = (ws?.plan_tier ?? 'starter') as TierKey
  const cap = TIER_CAPS[tier]?.total_prospects ?? TIER_CAPS.starter.total_prospects

  const { count } = await admin
    .from('contacts')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)

  const current = count ?? 0

  if (current + amountToAdd > cap) {
    return {
      allowed: false,
      reason: `You've reached your contact limit (${cap.toLocaleString()} total). Upgrade your plan to import more.`,
      currentCount: current,
      cap,
    }
  }

  return { allowed: true, currentCount: current, cap }
}

export async function checkTierLimit(
  workspaceId: string,
  metric: UsageMetric,
  amount = 1,
): Promise<{ allowed: boolean; reason?: string; currentUsage: number; cap: number }> {
  const admin = createAdminClient()

  const { data: ws } = await admin
    .from('workspaces').select('plan_tier, overage_enabled, current_period_start, current_period_end')
    .eq('id', workspaceId).single()

  const tier = (ws?.plan_tier ?? 'starter') as TierKey
  const caps = TIER_CAPS[tier] ?? TIER_CAPS.starter

  // Monthly metric — window anchored on the Stripe billing period (or the
  // calendar month when the workspace is not on a paid subscription — trial
  // fallback preserved). See lib/billing-period.ts.
  const period = getUsagePeriod(ws)

  // Upper bound `.lt(period_start, period.end)` is required in addition to
  // `.gte(period.start, ...)`: on paid→trial or paid→canceled transitions the
  // workspace's period columns get nulled, `getUsagePeriod` falls back to the
  // calendar month, and rows written under the earlier paid window could then
  // leak into the fallback window if they happen to sit above its `start`.
  const { data: rows } = await admin
    .from('usage_tracking')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('metric', metric)
    .gte('period_start', period.start)
    .lt('period_start', period.end)

  const current = (rows ?? []).reduce((s, r) => s + r.value, 0)

  if (metric === 'prospects_sourced') {
    const cap = caps.prospects_sourced_per_month
    if (current + amount > cap) {
      return {
        allowed: false,
        reason: `Monthly sourced-prospects cap reached (${cap} on ${tier} plan). Upgrade to source more.`,
        currentUsage: current,
        cap,
      }
    }
    return { allowed: true, currentUsage: current, cap }
  }

  // enrichments_used — overage eligible
  const cap = caps.enrichments_per_month
  if (current + amount > cap) {
    if (metric === 'enrichments_used' && ws?.overage_enabled) {
      triggerOverageChargeIfNeeded(workspaceId).catch(e => console.error('[overage]', e))
      return { allowed: true, currentUsage: current, cap }
    }
    return {
      allowed: false,
      reason: `Monthly enrichment cap reached (${cap} on ${tier} plan). Upgrade or enable overage.`,
      currentUsage: current,
      cap,
    }
  }

  return { allowed: true, currentUsage: current, cap }
}

// NOTE: 'prospects_sourced' requires migration to add to usage_tracking.metric CHECK constraint
// (004_stripe_subscriptions.sql CHECK constraint currently allows only:
//  'prospects_added','enrichments_used','emails_sent','meetings_booked')
// Métriques qui déclenchent une notif de franchissement de seuil, avec le
// cap correspondant dans TIER_CAPS et les titres localisés (grammaire FR
// gérée à la main : quota = singulier masculin, crédits = pluriel masculin).
// `meetings_booked` n'a pas de cap → skip par omission.
const USAGE_NOTIF_MAP: Record<
  'emails_sent' | 'enrichments_used' | 'prospects_sourced',
  {
    type:    string
    capKey:  'emails_per_month' | 'enrichments_per_month' | 'prospects_sourced_per_month'
    title80: LocalizedText
    title100: LocalizedText
  }
> = {
  emails_sent: {
    type:   'email_quota',
    capKey: 'emails_per_month',
    title80:  { en: "You've used 80% of your email quota",
                fr: "Vous avez utilisé 80 % de votre quota d'e-mails" },
    title100: { en: 'Email quota limit reached',
                fr: "Quota d'e-mails atteint" },
  },
  enrichments_used: {
    type:   'credits_threshold',
    capKey: 'enrichments_per_month',
    title80:  { en: "You've used 80% of your enrichment credits",
                fr: "Vous avez utilisé 80 % de vos crédits d'enrichissement" },
    title100: { en: 'Enrichment credits limit reached',
                fr: "Crédits d'enrichissement atteints" },
  },
  prospects_sourced: {
    type:   'credits_threshold',
    capKey: 'prospects_sourced_per_month',
    title80:  { en: "You've used 80% of your prospect credits",
                fr: 'Vous avez utilisé 80 % de vos crédits prospects' },
    title100: { en: 'Prospect credits limit reached',
                fr: 'Crédits prospects atteints' },
  },
}

export async function trackUsage(
  workspaceId: string,
  metric: 'enrichments_used' | 'emails_sent' | 'meetings_booked' | 'prospects_sourced',
  value = 1,
) {
  const admin = createAdminClient()

  // Cohérence write↔read : la période écrite ici DOIT matcher celle lue par
  // checkTierLimit / usage/current / bot-ai / overage-charge — sinon les
  // compteurs mensuels se désynchronisent aux bornes de période. On lit
  // donc les colonnes Stripe du workspace (fetch minimal) avant d'écrire.
  // On ajoute plan_tier au SELECT pour dériver le cap en mémoire (TIER_CAPS)
  // sans SELECT supplémentaire.
  const { data: ws } = await admin
    .from('workspaces')
    .select('plan_tier, overage_enabled, current_period_start, current_period_end')
    .eq('id', workspaceId)
    .single()

  const period = getUsagePeriod(ws)

  await admin.from('usage_tracking').insert({
    workspace_id: workspaceId,
    metric,
    value,
    period_start: period.start,
  })

  // Détection franchissement de seuil — best-effort, jamais throw.
  // meetings_booked : pas de cap, skip.
  const notifCfg = USAGE_NOTIF_MAP[metric as keyof typeof USAGE_NOTIF_MAP]
  if (!notifCfg) return

  try {
    const tier = (ws?.plan_tier ?? 'starter') as TierKey
    const caps = TIER_CAPS[tier] ?? TIER_CAPS.starter
    const cap  = caps[notifCfg.capKey]
    if (!cap || cap <= 0) return  // pas de cap effectif (ex: free/prospects_sourced=0)

    // SUM usage APRÈS INSERT — même fenêtre que checkTierLimit.
    const { data: rows, error: sumErr } = await admin
      .from('usage_tracking')
      .select('value')
      .eq('workspace_id', workspaceId)
      .eq('metric', metric)
      .gte('period_start', period.start)
      .lt('period_start', period.end)
    if (sumErr) {
      console.error('[trackUsage:threshold] SUM query failed', { metric, error: sumErr.message })
      return
    }
    const usageAfter  = (rows ?? []).reduce((s, r) => s + r.value, 0)
    const usageBefore = usageAfter - value

    // Fire une seule fois par seuil : détecte le FRANCHISSEMENT (crossing)
    // entre before et after. Double-fire concurrent (deux trackUsage en même
    // temps qui traversent le même seuil) est un mineur acceptable — le user
    // reçoit 2 notifs identiques dans le pire cas, jamais 0.
    for (const threshold of [0.8, 1.0] as const) {
      const trip = threshold * cap
      if (usageBefore < trip && usageAfter >= trip) {
        // Polish overage : pour `enrichments_used` au seuil 1.0 quand
        // overage_enabled=true, on remplace le "limit reached" (qui suggère
        // un blocage) par un message qui annonce clairement la facturation
        // du dépassement. Aligné sur checkTierLimit qui laisse passer les
        // enrichments overage-eligible sans bloquer. Les autres métriques
        // (emails_sent, prospects_sourced) restent hard cap, message inchangé.
        const isEnrichOverage = threshold === 1.0
          && metric === 'enrichments_used'
          && ws?.overage_enabled === true
        const title: LocalizedText = isEnrichOverage
          ? {
              en: 'Included enrichment credits used — extra usage now billed as overage',
              fr: "Crédits d'enrichissement inclus épuisés — le dépassement est désormais facturé",
            }
          : threshold === 1.0
            ? notifCfg.title100
            : notifCfg.title80
        notifyWorkspaceOwner(workspaceId, {
          type:     notifCfg.type,
          category: 'billing',
          title,
          link:     '/dashboard/billing',
          metadata: {
            metric,
            currentUsage: usageAfter,
            cap,
            threshold,
          },
        }).catch(() => {})
      }
    }
  } catch (err) {
    console.error('[trackUsage:threshold] unexpected failure', {
      workspace_id: workspaceId, metric,
      error: err instanceof Error ? err.message : 'unknown',
    })
  }
}
