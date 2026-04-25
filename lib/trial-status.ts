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

  if (workspace.subscription_status === 'active') {
    return { status: 'active', daysRemaining: -1, blockedActions: false }
  }

  if (workspace.subscription_status === 'past_due') {
    return { status: 'past_due', daysRemaining: 0, blockedActions: true }
  }

  if (workspace.subscription_status === 'canceled') {
    return { status: 'canceled', daysRemaining: 0, blockedActions: true }
  }

  if (workspace.subscription_status === 'trialing' && trialEnd && now < trialEnd) {
    const daysRemaining = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24))
    return { status: 'trialing', daysRemaining, blockedActions: false }
  }

  return { status: 'expired', daysRemaining: 0, blockedActions: true }
}
