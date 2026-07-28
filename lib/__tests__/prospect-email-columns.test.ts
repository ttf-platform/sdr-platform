import { describe, expect, it } from 'vitest'
import {
  PROSPECT_EMAIL_CLIENT_COLUMNS,
  PROSPECT_EMAIL_LIST_COLUMNS,
} from '../prospect-email-columns'

// The 4 vendor-tainted columns documented in the doctrine block in
// lib/prospect-email-columns.ts. Any of them appearing as a select target
// is a vendor-invisibility violation (Instantly / SMTP host / provider
// name substrings could leak into the response).
const FORBIDDEN_TOKENS = ['provider', 'send_error', 'thread_id', 'bounce_reason'] as const

// Parse a Postgrest column-list string into the actual column names.
// Naive substring matches would (incorrectly) fail on 'provider_message_id'
// (which is vendor-SAFE per the doctrine) → we parse the tokens instead.
function parseColumns(list: string): string[] {
  return list
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
}

describe('PROSPECT_EMAIL_CLIENT_COLUMNS (approve response)', () => {
  const cols = parseColumns(PROSPECT_EMAIL_CLIENT_COLUMNS)

  it.each(FORBIDDEN_TOKENS)('does NOT include the vendor-tainted column %s', (forbidden) => {
    // Exact column-name match, not substring — provider_message_id must stay.
    expect(cols).not.toContain(forbidden)
  })

  it('INCLUDES provider_message_id (vendor-safe opaque UUID per doctrine)', () => {
    // Regression guard for the naive test that would fail on the substring
    // 'provider' — provider_message_id is the whole point of the allowlist
    // for the approve response and must NOT be caught by the token filter.
    expect(cols).toContain('provider_message_id')
  })
})

describe('PROSPECT_EMAIL_LIST_COLUMNS (list + detail + PATCH + reject response)', () => {
  const cols = parseColumns(PROSPECT_EMAIL_LIST_COLUMNS)

  it.each(FORBIDDEN_TOKENS)('does NOT include the vendor-tainted column %s', (forbidden) => {
    expect(cols).not.toContain(forbidden)
  })

  it('INCLUDES provider_message_id (vendor-safe opaque UUID per doctrine)', () => {
    expect(cols).toContain('provider_message_id')
  })

  it('covers every field currently read by the client consumers', () => {
    // Per the recon audit :
    //   - campaigns/[id]/page.tsx renders : id, subject, body, status
    //   - EditEmailModal renders          : subject, body, mode, step_order (JOIN)
    //   - EmailDraft TS type declares     : id, subject, body, mode, status,
    //                                        step_order (JOIN), step_type (JOIN)
    //   - prospect/step fields come from  : JOIN (untouched), not from base cols
    const required = ['id', 'subject', 'body', 'mode', 'status']
    for (const col of required) expect(cols).toContain(col)
  })

  it('does NOT include workspace_id (internal scoping, not for the client)', () => {
    expect(cols).not.toContain('workspace_id')
  })
})

// Shape assertions on both allowlists. These do NOT hit a database — that
// gate lives in scripts/verify-column-allowlists.ts, which resolves the
// names against a live schema. Here we only catch structural mistakes a
// PostgREST call would otherwise translate silently into "column does not
// exist" (`42703`) at runtime : accidental double comma, blank token,
// duplicate name (harmless to PostgREST but a clue the audit block below
// went out of sync with the string).
describe.each([
  ['PROSPECT_EMAIL_CLIENT_COLUMNS', PROSPECT_EMAIL_CLIENT_COLUMNS],
  ['PROSPECT_EMAIL_LIST_COLUMNS',   PROSPECT_EMAIL_LIST_COLUMNS],
] as const)('%s — shape', (_, list) => {
  it('contains no empty tokens (no `,,`, no trailing comma)', () => {
    // parseColumns() already filters length > 0 — we assert on the RAW
    // split so an empty token would surface as a failure.
    const raw = list.split(',').map((c) => c.trim())
    expect(raw.every((c) => c.length > 0)).toBe(true)
  })

  it('contains no duplicate columns', () => {
    const cols = parseColumns(list)
    const seen = new Set(cols)
    expect(seen.size).toBe(cols.length)
  })

  it('every token matches a valid Postgres column identifier ([a-z_][a-z0-9_]*)', () => {
    // Catches accidental embedded spaces, punctuation, or JOIN syntax that
    // would need a separate audit path than an allowlist.
    const cols = parseColumns(list)
    const rx = /^[a-z_][a-z0-9_]*$/
    for (const c of cols) expect(c).toMatch(rx)
  })
})
