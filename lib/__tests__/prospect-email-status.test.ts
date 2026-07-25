import { describe, it, expect } from 'vitest'
import { COMMITTED_STATUSES, isCommitted } from '../prospect-email-status'

describe('COMMITTED_STATUSES', () => {
  it('is exactly sending/sent/bounced/replied — order matters for the .not("status","in",...) filter', () => {
    expect([...COMMITTED_STATUSES]).toEqual(['sending', 'sent', 'bounced', 'replied'])
  })
})

describe('isCommitted', () => {
  it('returns true for every committed state', () => {
    for (const s of COMMITTED_STATUSES) expect(isCommitted(s)).toBe(true)
  })

  it.each(['draft', 'edited', 'approved', 'rejected', 'failed'])(
    'returns false for pre-commit / terminal-non-sent state %s',
    (s) => { expect(isCommitted(s)).toBe(false) },
  )

  it('returns false for nullish / empty input', () => {
    expect(isCommitted(null)).toBe(false)
    expect(isCommitted(undefined)).toBe(false)
    expect(isCommitted('')).toBe(false)
  })
})
