import { describe, it, expect } from 'vitest'
import { nextDunningStage } from '../dunning'

describe('nextDunningStage — pure decision fn', () => {
  it('stage 0 with elapsedDays < 3 → null (too early for J+3)', () => {
    expect(nextDunningStage({ elapsedDays: 0, stage: 0 })).toBeNull()
    expect(nextDunningStage({ elapsedDays: 2, stage: 0 })).toBeNull()
  })

  it('stage 0 with elapsedDays >= 3 → escalate to J+3, newStage=1', () => {
    expect(nextDunningStage({ elapsedDays: 3, stage: 0 }))
      .toEqual({ stageKey: 'dunning_j3', newStage: 1 })
    expect(nextDunningStage({ elapsedDays: 5, stage: 0 }))
      .toEqual({ stageKey: 'dunning_j3', newStage: 1 })
    // If a J+7-worthy row is somehow still at stage 0 (e.g. cron never ran
    // on day 3), we do NOT jump straight to J+7 : only one escalation per
    // run, so we take J+3 first. J+7 will fire on the next cron day.
    expect(nextDunningStage({ elapsedDays: 10, stage: 0 }))
      .toEqual({ stageKey: 'dunning_j3', newStage: 1 })
  })

  it('stage 1 with elapsedDays < 7 → null (too early for J+7)', () => {
    expect(nextDunningStage({ elapsedDays: 3, stage: 1 })).toBeNull()
    expect(nextDunningStage({ elapsedDays: 6, stage: 1 })).toBeNull()
  })

  it('stage 1 with elapsedDays >= 7 → escalate to J+7, newStage=2', () => {
    expect(nextDunningStage({ elapsedDays: 7, stage: 1 }))
      .toEqual({ stageKey: 'dunning_j7', newStage: 2 })
    expect(nextDunningStage({ elapsedDays: 30, stage: 1 }))
      .toEqual({ stageKey: 'dunning_j7', newStage: 2 })
  })

  it('stage 2 → null (terminal, no further escalation)', () => {
    expect(nextDunningStage({ elapsedDays: 0, stage: 2 })).toBeNull()
    expect(nextDunningStage({ elapsedDays: 30, stage: 2 })).toBeNull()
    expect(nextDunningStage({ elapsedDays: 999, stage: 2 })).toBeNull()
  })

  it('unknown / defensive stages → null (never escalate on garbage data)', () => {
    expect(nextDunningStage({ elapsedDays: 30, stage: 3 })).toBeNull()
    expect(nextDunningStage({ elapsedDays: 30, stage: -1 })).toBeNull()
  })
})
