// Sonde V19 - test VOLONTAIREMENT cassé. Branche jetable, jamais fusionnée dans main.
import { describe, it, expect } from 'vitest'

describe('sonde V19', () => {
  it('echoue volontairement', () => {
    expect(1).toBe(2)
  })
})
