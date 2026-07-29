import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ─── Test scope ─────────────────────────────────────────────────────────────
//
// The brief-mandated assertion : Modal.onClose from WelcomeModal must NEVER
// trigger navigation. Escape (Modal.tsx:129) and the built-in ✕
// (Modal.tsx:180) both fire onClose, and the pre-fix wiring fused close
// with router.push('/dashboard/profile#icp'), silently deep-linking users
// who tried to skip the tour.
//
// This repo does not ship @testing-library/react + jsdom, so we assert
// the wiring at the source level. The check catches every regression that
// re-fuses close and Let's-go, without depending on a DOM harness. A
// future refactor that renames handleClose is free to touch the pattern
// as long as onClose still resolves to a function that does not chain
// into onLetsGo.

const SRC = readFileSync(
  resolve(__dirname, '../WelcomeModal.tsx'),
  'utf8',
)

function extractFunctionBody(source: string, name: string): string {
  // Match `async function <name>() { … balanced-braces }`.
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`function ${name} not found`)
  const braceOpen = source.indexOf('{', start)
  let depth = 0
  for (let i = braceOpen; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(braceOpen, i + 1)
    }
  }
  throw new Error(`unterminated body for function ${name}`)
}

describe('WelcomeModal — onClose does not navigate', () => {
  it('handleClose does NOT reference onLetsGo (the only navigation callback in this file)', () => {
    const body = extractFunctionBody(SRC, 'handleClose')
    // Positive guarantee : dismisses temporarily so the four "close" gestures
    // share the session-scoped dismiss state.
    expect(body).toContain('onDismissTemporary')
    expect(body).toContain('setIsOpen(false)')
    // Negative guarantee : never invoke onLetsGo from the close path.
    expect(body).not.toContain('onLetsGo')
  })

  it('handleLetsGo IS wired to onLetsGo (regression guard on the other direction)', () => {
    const body = extractFunctionBody(SRC, 'handleLetsGo')
    expect(body).toContain('onDismissTemporary')
    expect(body).toContain('setIsOpen(false)')
    // The tour-start path must still call onLetsGo — otherwise the "Let's go"
    // button becomes a no-op close.
    expect(body).toContain('onLetsGo')
  })

  it('<Modal ... onClose=…> is wired to handleClose, not handleLetsGo', () => {
    // Find the <Modal opening tag and its onClose attribute. `onClose=` is
    // unique in this file to the Modal render.
    const idx = SRC.indexOf('onClose=')
    expect(idx).toBeGreaterThan(-1)
    // The wiring value is the identifier that follows onClose= — either
    // {handleClose} or {handleLetsGo}. Assert it's the close-only variant.
    const attr = SRC.slice(idx, idx + 40)
    expect(attr).toMatch(/onClose=\{handleClose\}/)
    expect(attr).not.toMatch(/onClose=\{handleLetsGo\}/)
  })

  it('handleTrySample and handleNever also do not navigate (already-correct baseline pinned)', () => {
    // These two are the other Modal-close-adjacent handlers. handleTrySample
    // calls onTrySample (which may router.push in the parent, but that IS
    // the sample-data path — voulu) or window.location.reload if no
    // campaign was seeded. handleNever just persists + closes. Neither
    // touches onLetsGo, and this test locks that invariant so a future
    // refactor of this file cannot accidentally re-introduce the
    // close-side-effect drift on either handler.
    expect(extractFunctionBody(SRC, 'handleTrySample')).not.toContain('onLetsGo')
    expect(extractFunctionBody(SRC, 'handleNever')).not.toContain('onLetsGo')
  })
})
