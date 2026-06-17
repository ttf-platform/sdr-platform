export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'

export interface TrialStatusResult {
  status: SubscriptionStatus
  daysRemaining: number
  blockedActions: boolean
}

export function getTrialStatus(workspace: {
  subscription_status?: string | null
  trial_end_date?: string | null
}): TrialStatusResult {
  const now = Date.now()
  const trialEnd = workspace.trial_end_date
    ? new Date(workspace.trial_end_date).getTime()
    : null
  const s = workspace.subscription_status

  if (s === 'active') {
    return { status: 'active', daysRemaining: -1, blockedActions: false }
  }

  if (s === 'past_due') {
    return { status: 'past_due', daysRemaining: 0, blockedActions: true }
  }

  if (s === 'canceled') {
    return { status: 'canceled', daysRemaining: 0, blockedActions: true }
  }

  if (s === 'expired') {
    return { status: 'expired', daysRemaining: 0, blockedActions: true }
  }

  if (s === 'trialing') {
    if (trialEnd && now < trialEnd) {
      const daysRemaining = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24))
      return { status: 'trialing', daysRemaining, blockedActions: false }
    }
    return { status: 'expired', daysRemaining: 0, blockedActions: true }
  }

  // Unknown status (null, '', or any unrecognized value) — fail CLOSED, log for diagnosis
  console.warn('[getTrialStatus] Unrecognized subscription_status — blocking (fail-closed):', { subscription_status: s })
  return { status: 'expired', daysRemaining: 0, blockedActions: true }
}
