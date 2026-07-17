#!/usr/bin/env node
// Throwaway test script — BetterContact email enrichment only.
// Run: node --env-file=.env.local scripts/batch-test-bettercontact.mjs
//
// Purpose: measure real find rate + $/valid-email on 10 EU public B2B founders,
// to decide whether BetterContact replaces Findymail as the email brick.
//
// Lead Finder is UI-only (Rails turbo-frame, no REST API) — NOT tested here.
//
// STRICT budget:
//   Remaining trial credits ≈ 50
//   This run           = 10 leads submitted → expect ≈ 10 credits (pay-per-valid)
//   Hard stop          = credits_left < 5 during polling → abort & report
//
// Security:
//   - Never logs API key.
//   - All email fields deep-redacted in every log line.
//   - No PII written to disk; aggregated counters → stdout only.

const BC_KEY = process.env.BETTERCONTACT_API_KEY
if (!BC_KEY) {
  console.error('Missing BETTERCONTACT_API_KEY in env. Run with: node --env-file=.env.local scripts/batch-test-bettercontact.mjs')
  process.exit(1)
}

const ENR_POST_URL = 'https://app.bettercontact.rocks/api/v2/async'
const ENR_GET_URL  = (id) => `https://app.bettercontact.rocks/api/v2/async/${id}`

// Cost extrapolation — ASSUMPTION (Pro tier $49 / 1000 credits)
const PRICE_PER_CREDIT_USD = 0.049

// Guardrails
const HARD_STOP_CREDITS_LEFT = 5
const POLL_INTERVAL_MS       = 6000
const POLL_TIMEOUT_MS        = 5 * 60 * 1000

const H = () => ({
  'Content-Type': 'application/json',
  'X-API-Key':    BC_KEY,
})

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Dataset — 10 public EU B2B founders / partners (FR / DE / UK).
// Person↔domain associations picked from widely public professional identities.
// Confidence flags in comments so Max can vet before running.
// ---------------------------------------------------------------------------

const DATASET = [
  // ---- France ----
  { first_name: 'Guillaume', last_name: 'Moubeche', company: 'Lemlist',           company_domain: 'lemlist.com',   country: 'FR' }, // very high
  { first_name: 'Alexandre', last_name: 'Prot',     company: 'Qonto',             company_domain: 'qonto.com',     country: 'FR' }, // very high
  { first_name: 'Jonathan',  last_name: 'Anguelov', company: 'Aircall',           company_domain: 'aircall.io',    country: 'FR' }, // very high
  // ---- Germany ----
  { first_name: 'Christian', last_name: 'Reber',    company: 'Pitch',             company_domain: 'pitch.com',     country: 'DE' }, // very high
  { first_name: 'Filip',     last_name: 'Dames',    company: 'Cherry Ventures',   company_domain: 'cherry.vc',     country: 'DE' }, // very high
  { first_name: 'Christian', last_name: 'Miele',    company: 'Headline',          company_domain: 'headline.com',  country: 'DE' }, // medium — flag if he moved firms
  // ---- United Kingdom ----
  { first_name: 'Harry',     last_name: 'Stebbings', company: '20VC',             company_domain: '20vc.com',       country: 'UK' }, // very high
  { first_name: 'Hiroki',    last_name: 'Takeuchi',  company: 'GoCardless',       company_domain: 'gocardless.com', country: 'UK' }, // very high
  { first_name: 'Kristo',    last_name: 'Käärmann',  company: 'Wise',             company_domain: 'wise.com',       country: 'UK' }, // very high
  { first_name: 'Suranga',   last_name: 'Chandratillake', company: 'Balderton Capital', company_domain: 'balderton.com', country: 'UK' }, // very high
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(obj, maxLen = 900) {
  const s = JSON.stringify(obj, null, 2)
  return s.length > maxLen ? s.slice(0, maxLen) + '…[truncated]' : s
}

// Deep-redact any key containing "email" before logging response shapes.
function redactShape(obj) {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(redactShape)
  if (typeof obj === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k.toLowerCase().includes('email') && typeof v === 'string') out[k] = '<redacted>'
      else out[k] = redactShape(v)
    }
    return out
  }
  return obj
}

async function fetchJson(url, init, label) {
  try {
    const res = await fetch(url, init)
    let json = {}
    try { json = await res.json() } catch { /* body may be empty */ }
    return { ok: res.ok, status: res.status, json }
  } catch (err) {
    console.log(`  [fetch error · ${label}] ${err.message}`)
    return { ok: false, status: 0, json: {} }
  }
}

function extractCredits(json) {
  return {
    consumed: json?.credits_consumed ?? json?.data?.credits_consumed ?? null,
    left:     json?.credits_left     ?? json?.data?.credits_left     ?? null,
  }
}

// Extract per-lead status string, no email value ever returned.
function statusOf(item) {
  return (item?.contact_email_address_status || item?.status || '').toString().toLowerCase()
}

function bucketOf(st) {
  if (!st) return 'not_found'
  if (st.includes('undeliverable'))                            return 'undeliverable'
  if (st.includes('not_found') || st === 'not found' || st.includes('notfound')) return 'not_found'
  if (st.includes('catch') && st.includes('not'))              return 'catch_all_not_safe'
  if (st.includes('catch') && st.includes('safe'))             return 'catch_all_safe'
  if (st.includes('valid'))                                    return 'valid'
  return 'other'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

;(async () => {
  console.log('Batch test — BetterContact email enrichment (10 EU public B2B founders)')
  console.log(`Budget: submit 10 leads (≤ ~10 credits expected) · hard stop if credits_left < ${HARD_STOP_CREDITS_LEFT}`)
  console.log(`Poll: every ${POLL_INTERVAL_MS / 1000}s · timeout ${POLL_TIMEOUT_MS / 1000}s`)
  console.log(`Dataset (${DATASET.length}): FR=${DATASET.filter(d => d.country === 'FR').length} · DE=${DATASET.filter(d => d.country === 'DE').length} · UK=${DATASET.filter(d => d.country === 'UK').length}`)

  const payload = {
    data: DATASET.map(({ first_name, last_name, company, company_domain }) => ({
      first_name, last_name, company, company_domain,
      linkedin_url: '',
      custom_fields: {},
    })),
    enrich_email_address: true,
    enrich_phone_number:  false,
  }

  console.log('\n=== POST /api/v2/async ===')
  const post = await fetchJson(ENR_POST_URL, {
    method: 'POST', headers: H(), body: JSON.stringify(payload),
  }, 'ENR POST')

  console.log(`  http=${post.status}`)
  if (!post.ok) {
    console.log(`  error body: ${truncate(redactShape(post.json))}`)
    process.exit(1)
  }

  const jobId = post.json?.id || post.json?.request_id || post.json?.data?.id
  if (!jobId) {
    console.log(`  ✖ no id in response: ${truncate(redactShape(post.json))}`)
    process.exit(1)
  }
  console.log(`  id=${jobId}`)

  console.log('\n=== Poll GET /api/v2/async/{id} ===')
  const started = Date.now()
  let attempt = 0
  let last = null
  let hitHardStop = false
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    attempt++
    await sleep(POLL_INTERVAL_MS)
    const get = await fetchJson(ENR_GET_URL(jobId), { method: 'GET', headers: H() }, `ENR GET #${attempt}`)
    last = get
    const status = get.json?.status || get.json?.state || get.json?.data?.status
    const credits = extractCredits(get.json)
    console.log(`  poll #${attempt} http=${get.status} status=${status ?? '(none)'} credits_consumed=${credits.consumed ?? '?'} credits_left=${credits.left ?? '?'}`)

    if (attempt === 1) {
      console.log('  [first-poll shape, deep-redacted]:')
      console.log('  ' + truncate(redactShape({ http_status: get.status, top_level_keys: Object.keys(get.json || {}), shape: get.json })).replace(/\n/g, '\n  '))
    }

    if (typeof credits.left === 'number' && credits.left < HARD_STOP_CREDITS_LEFT) {
      console.log(`  ⛔ credits_left=${credits.left} < ${HARD_STOP_CREDITS_LEFT} → stop polling, report state.`)
      hitHardStop = true
      break
    }

    const terminal = ['completed', 'complete', 'done', 'finished', 'success', 'terminated']
    const failed   = ['failed', 'error', 'errored', 'cancelled', 'canceled']
    const s = String(status || '').toLowerCase()
    if (terminal.some(t => s.includes(t))) break
    if (failed.some(t => s.includes(t))) {
      console.log(`  ✖ terminal failure: ${status}`)
      break
    }
  }

  if (!last) {
    console.log('No response captured (timeout without any poll).')
    process.exit(1)
  }

  // ---------------- Result extraction ----------------
  const rootData = last.json?.data ?? last.json
  const summary = last.json?.summary || last.json?.counts || rootData?.summary || rootData?.counts || null
  const results = last.json?.results || rootData?.results || rootData?.data || (Array.isArray(rootData) ? rootData : [])
  const items = Array.isArray(results) ? results : (Array.isArray(results?.data) ? results.data : [])
  const credits = extractCredits(last.json)

  const tally = { valid: 0, catch_all_safe: 0, catch_all_not_safe: 0, undeliverable: 0, not_found: 0, other: 0 }
  for (const it of items) tally[bucketOf(statusOf(it))]++

  // Prefer server-side summary when it exists; fall back to tally.
  const total              = summary?.total              ?? items.length
  const valid              = summary?.valid              ?? tally.valid
  const catch_all_safe     = summary?.catch_all_safe     ?? tally.catch_all_safe
  const catch_all_not_safe = summary?.catch_all_not_safe ?? tally.catch_all_not_safe
  const undeliverable      = summary?.undeliverable      ?? tally.undeliverable
  const not_found          = summary?.not_found          ?? tally.not_found

  const submitted = DATASET.length
  const findRate  = submitted > 0 ? ((valid + catch_all_safe) / submitted) : 0
  const findRateStrict = submitted > 0 ? (valid / submitted) : 0

  console.log('\n=== Enrichment summary ===')
  console.log(`  Submitted:               ${submitted}`)
  console.log(`  Total in response:       ${total}`)
  console.log(`  Valid:                   ${valid}`)
  console.log(`  Catch-all safe:          ${catch_all_safe}`)
  console.log(`  Catch-all not safe:      ${catch_all_not_safe}`)
  console.log(`  Undeliverable:           ${undeliverable}`)
  console.log(`  Not found:               ${not_found}`)
  if (tally.other > 0) console.log(`  Other/unmapped statuses: ${tally.other}`)
  console.log(`  Find rate (valid + catch_all_safe / submitted): ${(findRate * 100).toFixed(0)}%`)
  console.log(`  Find rate strict (valid / submitted):           ${(findRateStrict * 100).toFixed(0)}%`)
  console.log(`  credits_consumed:        ${credits.consumed ?? '?'}`)
  console.log(`  credits_left:            ${credits.left ?? '?'}`)
  if (hitHardStop) console.log(`  ⚠ Hard stop triggered — figures above may be partial.`)

  // ---------------- Cost extrapolation ----------------
  const creditsUsed = Number(credits.consumed) || 0
  const dollars     = creditsUsed * PRICE_PER_CREDIT_USD
  const actionable  = valid + catch_all_safe
  const perValid    = actionable > 0 ? dollars / actionable : null

  console.log('\n=== Cost extrapolation ===')
  console.log(`  ASSUMPTION: $/credit = $${PRICE_PER_CREDIT_USD} (Pro tier $49 / 1000 credits)`)
  console.log(`  Credits consumed:        ${creditsUsed}`)
  console.log(`  $ spent (extrapolated):  $${dollars.toFixed(2)}`)
  console.log(`  Actionable emails:       ${actionable} (valid + catch_all_safe)`)
  console.log(`  $/actionable prospect:   ${perValid !== null ? `$${perValid.toFixed(2)}` : 'n/a (no actionable email)'}`)
  console.log(`  Mirvo model target:      $0.40 / prospect`)
  console.log(`  Findymail benchmark:     ~65% find rate (previous test)`)

  console.log('\nDone.')
})().catch(err => {
  console.error('Script failed:', err.message)
  process.exit(1)
})
