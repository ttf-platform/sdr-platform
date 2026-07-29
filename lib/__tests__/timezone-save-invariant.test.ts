import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// C1 invariant : the two save paths (settings/page.tsx::saveCompany +
// meetings/page.tsx::saveScheduler) MUST omit their timezone field from
// the outgoing POST/PUT payload when their local `origin` state is
// 'fallback'. Without that omission, a browser-detected default or a
// module-scope constant lands in booking_config.timezone as if the user
// had chosen it — the exact silent-write class this PR is fixing.
//
// This repo does not ship @testing-library/react + jsdom, so we lock the
// invariant at the source level. Same discipline as
// components/onboarding/__tests__/welcome-modal-onclose.test.ts. Any
// future refactor that removes the origin gate trips at least one
// assertion below.

const SETTINGS = readFileSync(
  resolve(__dirname, '../../app/(dashboard)/dashboard/settings/page.tsx'),
  'utf8',
)
const MEETINGS = readFileSync(
  resolve(__dirname, '../../app/(dashboard)/dashboard/meetings/page.tsx'),
  'utf8',
)

function extractFunctionBody(source: string, name: string): string {
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

describe("settings/page.tsx :: saveCompany — omits workspace_timezone when tzOrigin='fallback'", () => {
  const body = extractFunctionBody(SETTINGS, 'saveCompany')

  it("has a tzOrigin gate before including workspace_timezone in the payload", () => {
    // The gate can be spelled a few ways — assert the essential shape:
    // there is a conditional check on 'fallback' or on the tzOrigin state
    // that guards the assignment / inclusion of workspace_timezone.
    // If a future refactor unconditionally sets workspace_timezone from
    // form.timezone (the pre-fix shape), this assertion fails.
    expect(body).toMatch(/tzOrigin\s*!==\s*['"]fallback['"]|tzOrigin\s*===\s*['"]fallback['"]/)
    expect(body).toContain('workspace_timezone')
  })

  it("does NOT contain the pre-fix shape `workspace_timezone: form.timezone` at top level", () => {
    // The pre-fix line was `workspace_timezone: form.timezone,` inside
    // the JSON.stringify body — unconditional. That literal shape MUST
    // NOT appear as a top-level object property assignment in this
    // function body. (The conditional assignment via `payload
    // .workspace_timezone = form.timezone` is fine and DOES appear —
    // hence the check is against the `,` continuation that only appears
    // in the inline-object pre-fix version.)
    expect(body).not.toMatch(/workspace_timezone:\s*form\.timezone,/)
  })
})

describe("meetings/page.tsx :: saveScheduler — drops timezone key from PUT payload when sCfgTzOrigin='fallback'", () => {
  const body = extractFunctionBody(MEETINGS, 'saveScheduler')

  it("has an sCfgTzOrigin gate before dispatching the PUT", () => {
    // Same shape assertion : the outgoing config is prepared with a
    // conditional check on 'fallback', and the timezone key is
    // deleted / omitted when the check fires. If a future refactor
    // sends the raw sCfg without gating, this assertion fails.
    expect(body).toMatch(/sCfgTzOrigin\s*===\s*['"]fallback['"]/)
    expect(body).toMatch(/delete\s+outgoingConfig\.timezone|delete\s+\w+\.timezone/)
  })

  it("does NOT PUT the raw sCfg object as booking_config (pre-fix shape)", () => {
    // The pre-fix line was `booking_config: sCfg,` unconditionally. That
    // exact literal MUST be gone — a follow-up refactor that re-inlines
    // sCfg would trip this. The outgoing name we use is `outgoingConfig`,
    // deliberately distinct so both the human reader and this test can
    // tell the two variants apart.
    expect(body).not.toMatch(/booking_config:\s*sCfg\s*[,}]/)
    expect(body).toMatch(/booking_config:\s*outgoingConfig/)
  })
})
