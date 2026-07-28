/**
 * verify-column-allowlists.ts — schema-drift guard for lib/prospect-email-columns.ts
 *
 * ─── WHY ─────────────────────────────────────────────────────────────────
 * The two allowlists in lib/prospect-email-columns.ts are fed verbatim to
 * PostgREST .select() calls. When one column drifts from the real schema,
 * PostgREST rejects the entire query with `42703` — every consumer of the
 * allowlist silently returns { data: null, error: <42703> }. The typical
 * data-only destructure downstream (`const { data } = await …`) then
 * surfaces as "no row" and cascades through misleading fallbacks. Two
 * such incidents landed in July 2026 (PR #333 — `first_name` on
 * `prospects` ; this PR — `updated_at` on `prospect_emails`). Neither
 * was caught by `tsc`, `npm run build`, the 380 vitests, or
 * `/security-review`, because none of them confront the string against
 * the schema.
 *
 * This script executes each allowlist as a real `.select(<allowlist>)`
 * with `.limit(0)` (no data read) and fails LOUDLY on any `42703`.
 *
 * ─── HOW TO RUN ──────────────────────────────────────────────────────────
 * Env vars are passed explicitly — never from `.env.local` — so a
 * caller cannot silently point the script at prod when they meant
 * staging.
 *
 *   VERIFY_SUPABASE_URL='https://<project>.supabase.co' \
 *   VERIFY_SUPABASE_SERVICE_ROLE_KEY='<key>' \
 *   npx tsx scripts/verify-column-allowlists.ts
 *
 * Exit codes :
 *   0 — every allowlist matches the schema
 *   1 — at least one allowlist has an invalid column (42703) OR an env
 *       var is missing OR HTTP request failed
 *
 * ─── NOT WIRED TO CI ─────────────────────────────────────────────────────
 * Deliberately kept out of `.github/workflows/*` in the introducing PR.
 * Wiring is a separate decision : which environment does CI point at,
 * secrets provisioning, cache posture, and the failure-mode budget when
 * the target DB is unavailable.
 */

import {
  PROSPECT_EMAIL_CLIENT_COLUMNS,
  PROSPECT_EMAIL_LIST_COLUMNS,
} from '../lib/prospect-email-columns'

interface Allowlist {
  name:    string
  table:   string
  columns: string
}

const ALLOWLISTS: Allowlist[] = [
  { name: 'PROSPECT_EMAIL_CLIENT_COLUMNS', table: 'prospect_emails', columns: PROSPECT_EMAIL_CLIENT_COLUMNS },
  { name: 'PROSPECT_EMAIL_LIST_COLUMNS',   table: 'prospect_emails', columns: PROSPECT_EMAIL_LIST_COLUMNS },
]

const URL = process.env.VERIFY_SUPABASE_URL
const KEY = process.env.VERIFY_SUPABASE_SERVICE_ROLE_KEY

if (!URL || !KEY) {
  console.error('[verify-column-allowlists] missing env : VERIFY_SUPABASE_URL and/or VERIFY_SUPABASE_SERVICE_ROLE_KEY.')
  console.error('[verify-column-allowlists] see the script header for how to run.')
  process.exit(1)
}

async function checkOne(a: Allowlist): Promise<{ ok: true } | { ok: false; code: string; message: string; hint: string | null }> {
  // .limit(0) → PostgREST evaluates the projection against the schema
  // without ever reading a row. Any 42703 comes from the SELECT list
  // itself, not from the data.
  const url = `${URL}/rest/v1/${a.table}?select=${encodeURIComponent(a.columns)}&limit=0`
  const res = await fetch(url, {
    headers: {
      apikey:        KEY!,
      Authorization: `Bearer ${KEY}`,
    },
  })
  if (res.ok) return { ok: true }
  let body: { code?: string; message?: string; hint?: string | null } = {}
  try { body = await res.json() } catch { body = { message: await res.text() } }
  return {
    ok:      false,
    code:    body.code ?? String(res.status),
    message: body.message ?? '<no message>',
    hint:    body.hint ?? null,
  }
}

async function main() {
  let failed = 0
  for (const a of ALLOWLISTS) {
    process.stdout.write(`[verify] ${a.name} on ${a.table} … `)
    const result = await checkOne(a)
    if (result.ok) {
      console.log('OK')
      continue
    }
    failed++
    console.log('FAIL')
    console.error(`  code    : ${result.code}`)
    console.error(`  message : ${result.message}`)
    if (result.hint) console.error(`  hint    : ${result.hint}`)
    // Try to name the offending column when PostgREST tells us :
    //   "column <table>.<column> does not exist"
    const m = /column\s+([\w.]+)\s+does not exist/i.exec(result.message)
    if (m) console.error(`  offending column : ${m[1]}`)
    console.error(`  allowlist string  : ${a.columns}`)
  }

  if (failed > 0) {
    console.error(`\n[verify] ${failed} allowlist(s) failed. Fix the string or the schema and re-run.`)
    process.exit(1)
  }
  console.log('\n[verify] All allowlists match the schema.')
  process.exit(0)
}

main().catch(err => {
  console.error(`[verify] uncaught : ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
