/**
 * Dunning escalation decision — PURE.
 *
 * Called by the cron once per unresolved dunning_states row : given the
 * elapsed days since the initial J0 mail and the current stage marker,
 * decide whether to escalate to J+3 or J+7 and to which new stage. At
 * most one escalation per run — the cron will pick up J+7 on a later day.
 *
 * Stage numbering (matches the DB column) :
 *   0 = J0 mail sent (row seeded by the webhook right after the initial
 *       dunning email)
 *   1 = J+3 escalation sent
 *   2 = J+7 final-notice sent (terminal — no further escalation)
 *
 * Return null when nothing to do — the cron treats null as "skip, revisit
 * later".
 *
 * Lives in lib/ so it can be unit-tested without pulling the route module,
 * and so the route.ts stays free of non-route exports (Next.js gates on
 * that at build time, see fix/onboarding-route-export).
 */
export function nextDunningStage(p: {
  elapsedDays: number
  stage:       number
}): { stageKey: 'dunning_j3' | 'dunning_j7'; newStage: number } | null {
  if (p.stage === 0 && p.elapsedDays >= 3) return { stageKey: 'dunning_j3', newStage: 1 }
  if (p.stage === 1 && p.elapsedDays >= 7) return { stageKey: 'dunning_j7', newStage: 2 }
  return null
}
