/**
 * lib/quotas.ts
 *
 * Mailbox quota per subscription tier.
 *
 * Stored as a TypeScript const for V1 because the `plans` DB table does not
 * exist yet (Sprint 6 Stripe will create it). Once `plans` exists, migrate
 * this const into a `plans.mailbox_quota` column and delete this file —
 * the only call sites are the routes in /api/email-accounts/*, easy to swap.
 */

export type SubscriptionTier =
  | 'trial'
  | 'starter'
  | 'pro'
  | 'power'
  | 'team_starter'
  | 'team_pro'
  | 'corporate_trial'
  | 'corporate'
  | 'enterprise'
  | 'custom';

export const MAILBOX_QUOTA_BY_TIER: Record<SubscriptionTier, number> = {
  trial:           1,
  starter:         1,
  pro:             2,
  power:           3,
  team_starter:    5,
  team_pro:        10,
  // Corporate / enterprise / custom tiers — no hard cap by default,
  // billing is negotiated per contract. Sentinel value: Infinity.
  corporate_trial: Infinity,
  corporate:       Infinity,
  enterprise:      Infinity,
  custom:          Infinity,
};

/**
 * Get the mailbox quota for a given tier. Defaults to 1 (trial-equivalent)
 * for unknown tiers, which keeps abuse risk low while logging a warning.
 */
export function getMailboxQuota(tier: string | null | undefined): number {
  if (!tier) return 1;
  const normalized = tier.toLowerCase() as SubscriptionTier;
  if (normalized in MAILBOX_QUOTA_BY_TIER) {
    return MAILBOX_QUOTA_BY_TIER[normalized];
  }
  console.warn(
    `[quotas] Unknown subscription tier "${tier}", defaulting to quota=1`
  );
  return 1;
}

/**
 * Check whether a workspace can provision one more mailbox given its tier
 * and current count. Returns a verdict object so the API route can return
 * a structured 4xx with the upsell context.
 */
export interface QuotaCheckResult {
  allowed: boolean;
  current: number;
  max: number;
  tier: string;
  reason?: string;
}

export function checkMailboxQuota(
  tier: string | null | undefined,
  currentCount: number
): QuotaCheckResult {
  const max = getMailboxQuota(tier);
  const tierLabel = tier ?? 'trial';

  if (currentCount >= max) {
    return {
      allowed: false,
      current: currentCount,
      max,
      tier: tierLabel,
      reason: `Your ${tierLabel} plan is limited to ${max} mailbox${max === 1 ? '' : 'es'}. Upgrade to add more.`,
    };
  }
  return {
    allowed: true,
    current: currentCount,
    max,
    tier: tierLabel,
  };
}
