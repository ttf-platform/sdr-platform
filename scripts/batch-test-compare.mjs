#!/usr/bin/env node
// Throwaway test script — Compare BetterContact vs Findymail on the SAME leads.
// Run: node --env-file=.env.local scripts/batch-test-compare.mjs
//
// Pipeline:
//   1) PDL sources 10 real ICP EU leads (2 queries × size=5).
//   2) BetterContact enriches all 10.
//   3) Findymail enriches up to 5 of them (budget cap).
//   4) Emit a per-lead comparison + aggregate find rates + cost model.
//
// STRICT budgets:
//   PDL free      = ~44 lookups left → this run consumes ≤ 10.
//   BetterContact = ~50 credits, hard stop if credits_left < 5.
//   Findymail     = 5 credits, hard cap 5 attempts.
//
// Security:
//   - Never logs API keys.
//   - Emails deep-redacted in every log line; per-lead identity shown as initials.
//   - No PII written to disk; counters + statuses → stdout only.

const PDL_KEY  = process.env.PEOPLEDATALABS_API_KEY
const FM_KEY   = process.env.FINDYMAIL_API_KEY
const BC_KEY   = process.env.BETTERCONTACT_API_KEY

if (!PDL_KEY || !FM_KEY || !BC_KEY) {
  console.error('Missing PEOPLEDATALABS_API_KEY, FINDYMAIL_API_KEY, or BETTERCONTACT_API_KEY in env.')
  console.error('Run with: node --env-file=.env.local scripts/batch-test-compare.mjs')
  process.exit(1)
}

// Endpoints
const PDL_URL     = 'https://api.peopledatalabs.com/v5/person/search'
const FM_URL      = 'https://app.findymail.com/api/search/name'
const BC_POST_URL = 'https://app.bettercontact.rocks/api/v2/async'
const BC_GET_URL  = (id) => `https://app.bettercontact.rocks/api/v2/async/${id}`

// Pricing (extrapolation only — noted as assumption in output)
const EU_PRICE_PDL       = 0.28   // $/candidate returned (billed regardless of email)
const EU_PRICE_FM        = 0.05   // $/email found
const BC_PRICE_PER_CREDIT = 0.049 // Pro tier $49 / 1000 credits (ASSUMPTION)

// Sizes / caps
const PDL_SIZE       = 5           // 2 × 5 = 10 candidates
const PDL_SLEEP_MS   = 7000        // ≥ 6s to stay under 10 req/min
const FM_SLEEP_MS    = 1500
const FM_MAX         = 5           // Findymail budget cap
const BC_HARD_STOP   = 5           // stop polling if credits_left < 5
const BC_POLL_INTERVAL_MS = 6000
const BC_POLL_TIMEOUT_MS  = 5 * 60 * 1000

const EU_COUNTRIES = ['france', 'united kingdom', 'germany']

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// PDL queries — reuse v2's working queries (recruiters + consultants), size=5
// ---------------------------------------------------------------------------

const PDL_QUERIES = [
  {
    label: 'recruiters / staffing (EU)',
    query: {
      bool: {
        must: [
          { terms: { job_title_role: ['human_resources'] } },
          { match: { job_title: 'recruiter' } },
          { terms: { location_country: ['france', 'united kingdom', 'germany'] } },
        ],
      },
    },
  },
  {
    label: 'independent B2B consultants (EU)',
    query: {
      bool: {
        must: [
          { match: { job_title: 'consultant' } },
          { terms: { location_country: ['france', 'united kingdom', 'germany'] } },
        ],
        should: [
          { match: { job_company_size: '1-10' } },
          { match: { job_title: 'founder' } },
        ],
      },
    },
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(obj, maxLen = 700) {
  const s = JSON.stringify(obj, null, 2)
  return s.length > maxLen ? s.slice(0, maxLen) + '…[truncated]' : s
}

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

function initialsOf(l) {
  const f = (l.first_name || '?').trim().charAt(0).toUpperCase()
  const g = (l.last_name  || '?').trim().charAt(0).toUpperCase()
  return `${f}.${g}.`
}

function deriveDomain(website) {
  if (!website) return null
  try {
    return new URL(website.startsWith('http') ? website : `https://${website}`)
      .hostname.replace(/^www\./, '')
  } catch { return null }
}

async function fetchJson(url, init, label) {
  try {
    const res = await fetch(url, init)
    let json = {}
    try { json = await res.json() } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, json }
  } catch (err) {
    console.log(`  [fetch error · ${label}] ${err.message}`)
    return { ok: false, status: 0, json: {} }
  }
}

// ---------------------------------------------------------------------------
// Step 1 — PDL sourcing
// ---------------------------------------------------------------------------

async function runPDL() {
  console.log('\n=== Step 1 — PDL Person Search (10 leads target) ===')
  const leads = []
  let creditsConsumed = 0

  for (let i = 0; i < PDL_QUERIES.length; i++) {
    const q = PDL_QUERIES[i]
    console.log(`\n[PDL q${i + 1}] ${q.label}`)
    const res = await fetchJson(PDL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': PDL_KEY },
      body: JSON.stringify({ query: q.query, size: PDL_SIZE, pretty: false }),
    }, `PDL q${i + 1}`)

    console.log(`  http=${res.status}`)
    if (!res.ok || !Array.isArray(res.json.data)) {
      console.log(`  error: ${res.json?.error?.message ?? res.json?.error ?? 'unknown'}`)
    } else {
      const returned = res.json.data.length
      creditsConsumed += returned
      console.log(`  → ${returned} candidates (total available: ${res.json.total ?? '?'})`)
      for (const p of res.json.data) {
        const country = (p.location_country || '').toString().toLowerCase()
        const domain = deriveDomain(p.job_company_website)
        leads.push({
          first_name: p.first_name || null,
          last_name:  p.last_name  || null,
          full_name:  p.full_name  || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || null,
          company:    p.job_company_name || null,
          domain,
          linkedin_url: p.linkedin_url || (p.linkedin_username ? `https://linkedin.com/in/${p.linkedin_username}` : null),
          country,
          isEU: EU_COUNTRIES.some(c => country.includes(c)),
        })
      }
    }

    if (i < PDL_QUERIES.length - 1) {
      console.log(`  (sleep ${PDL_SLEEP_MS / 1000}s for rate limit)`)
      await sleep(PDL_SLEEP_MS)
    }
  }

  // Only keep leads that have first+last + (domain OR company)
  const eligible = leads.filter(l => l.first_name && l.last_name && (l.domain || l.company))
  const n = leads.length
  const euCount = leads.filter(l => l.isEU).length
  const pct = (num) => n > 0 ? `${Math.round((num / n) * 100)}%` : 'n/a'

  console.log('\n--- PDL sourcing summary ---')
  console.log(`  Candidates returned:            ${n}`)
  console.log(`  % located in EU:                ${pct(euCount)} (${euCount}/${n})`)
  console.log(`  Eligible for enrichment:        ${eligible.length}/${n}  (first+last + domain|company)`)
  console.log(`  Credits consumed (≈):           ${creditsConsumed}`)

  return { leads: eligible, creditsConsumed }
}

// ---------------------------------------------------------------------------
// Step 2 — BetterContact enrichment (async)
// ---------------------------------------------------------------------------

function bcExtractCredits(json) {
  return {
    consumed: json?.credits_consumed ?? json?.data?.credits_consumed ?? null,
    left:     json?.credits_left     ?? json?.data?.credits_left     ?? null,
  }
}

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

async function runBetterContact(leads) {
  console.log('\n=== Step 2 — BetterContact enrichment (all leads) ===')
  if (leads.length === 0) return { statusByLead: new Map(), credits: {}, summary: null }

  const payload = {
    data: leads.map(l => ({
      first_name: l.first_name,
      last_name:  l.last_name,
      company:    l.company || undefined,
      company_domain: l.domain || undefined,
      linkedin_url: l.linkedin_url || undefined,
      custom_fields: {},
    })),
    enrich_email_address: true,
    enrich_phone_number:  false,
  }

  const post = await fetchJson(BC_POST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': BC_KEY },
    body: JSON.stringify(payload),
  }, 'BC POST')

  console.log(`  POST http=${post.status}`)
  if (!post.ok) {
    console.log(`  error body: ${truncate(redactShape(post.json))}`)
    return { statusByLead: new Map(), credits: {}, summary: null }
  }

  const jobId = post.json?.id || post.json?.request_id || post.json?.data?.id
  if (!jobId) {
    console.log(`  ✖ no id in response: ${truncate(redactShape(post.json))}`)
    return { statusByLead: new Map(), credits: {}, summary: null }
  }
  console.log(`  id=${jobId} · polling every ${BC_POLL_INTERVAL_MS / 1000}s (timeout ${BC_POLL_TIMEOUT_MS / 1000}s)`)

  const started = Date.now()
  let attempt = 0
  let last = null
  let hitHardStop = false
  while (Date.now() - started < BC_POLL_TIMEOUT_MS) {
    attempt++
    await sleep(BC_POLL_INTERVAL_MS)
    const get = await fetchJson(BC_GET_URL(jobId), {
      method: 'GET', headers: { 'X-API-Key': BC_KEY },
    }, `BC GET #${attempt}`)
    last = get
    const status = get.json?.status || get.json?.state || get.json?.data?.status
    const credits = bcExtractCredits(get.json)
    console.log(`  poll #${attempt} http=${get.status} status=${status ?? '(none)'} credits_consumed=${credits.consumed ?? '?'} credits_left=${credits.left ?? '?'}`)

    if (attempt === 1) {
      console.log('  [BC first-poll shape, deep-redacted]:')
      console.log('  ' + truncate(redactShape({ http_status: get.status, top_level_keys: Object.keys(get.json || {}), shape: get.json })).replace(/\n/g, '\n  '))
    }

    if (typeof credits.left === 'number' && credits.left < BC_HARD_STOP) {
      console.log(`  ⛔ credits_left=${credits.left} < ${BC_HARD_STOP} → stop polling.`)
      hitHardStop = true
      break
    }

    const s = String(status || '').toLowerCase()
    if (['completed', 'complete', 'done', 'finished', 'success', 'terminated'].some(t => s.includes(t))) break
    if (['failed', 'error', 'errored', 'cancelled', 'canceled'].some(t => s.includes(t))) {
      console.log(`  ✖ terminal failure: ${status}`)
      break
    }
  }

  if (!last) return { statusByLead: new Map(), credits: {}, summary: null }

  const rootData = last.json?.data ?? last.json
  const summary  = last.json?.summary || last.json?.counts || rootData?.summary || rootData?.counts || null
  const results  = last.json?.results || rootData?.results || rootData?.data || (Array.isArray(rootData) ? rootData : [])
  const items    = Array.isArray(results) ? results : (Array.isArray(results?.data) ? results.data : [])
  const credits  = bcExtractCredits(last.json)

  // Map per-lead status. Match by first_name+last_name+domain when possible.
  const statusByLead = new Map()
  for (const it of items) {
    const fn = (it.first_name || '').toLowerCase()
    const ln = (it.last_name  || '').toLowerCase()
    const dom = (it.company_domain || '').toLowerCase()
    const key = `${fn}|${ln}|${dom}`
    statusByLead.set(key, bucketOf(statusOf(it)))
  }

  return { statusByLead, credits, summary, items, hitHardStop }
}

// ---------------------------------------------------------------------------
// Step 3 — Findymail enrichment (cap 5)
// ---------------------------------------------------------------------------

async function runFindymail(leads) {
  console.log('\n=== Step 3 — Findymail enrichment (cap 5, same leads) ===')
  const pool = leads.filter(l => l.full_name && l.domain).slice(0, FM_MAX)
  console.log(`  Eligible (full_name + domain): ${pool.length} / ${leads.length} · cap: ${FM_MAX}`)
  if (pool.length === 0) return { statusByLead: new Map(), attempted: 0, found: 0 }

  const statusByLead = new Map()
  let attempted = 0, found = 0, creditsConsumed = 0, firstRawLogged = false

  for (const l of pool) {
    if (attempted >= FM_MAX) break
    attempted++
    const res = await fetchJson(FM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${FM_KEY}` },
      body: JSON.stringify({ name: l.full_name, domain: l.domain }),
    }, `FM #${attempted}`)

    if (!firstRawLogged) {
      console.log('  [FM first raw, redacted]:')
      const shape = { http_status: res.status, top_level_keys: Object.keys(res.json || {}), shape: res.json }
      console.log('  ' + truncate(redactShape(shape)).replace(/\n/g, '\n  '))
      firstRawLogged = true
    }

    const hit = Boolean(res.json?.contact?.email)
    const key = `${(l.first_name || '').toLowerCase()}|${(l.last_name || '').toLowerCase()}|${(l.domain || '').toLowerCase()}`
    statusByLead.set(key, hit ? 'found' : 'miss')

    if (hit) { found++; creditsConsumed++ }
    console.log(`  [${attempted}] ${hit ? 'FOUND' : 'miss '} · ${initialsOf(l)} @ ${l.domain} (http ${res.status})`)

    await sleep(FM_SLEEP_MS)
  }

  const rate = attempted > 0 ? Math.round((found / attempted) * 100) : 0
  console.log('\n--- Findymail summary ---')
  console.log(`  Attempts:       ${attempted}`)
  console.log(`  Emails found:   ${found}`)
  console.log(`  Find rate:      ${rate}%`)
  console.log(`  Credits used:   ~${creditsConsumed}`)

  return { statusByLead, attempted, found, creditsConsumed }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

;(async () => {
  console.log('Batch test — Compare BetterContact vs Findymail on the SAME PDL-sourced leads')
  console.log(`Budgets: PDL ≤10 lookups · BC hard-stop if credits_left<${BC_HARD_STOP} · FM cap ${FM_MAX}`)

  const pdl = await runPDL()
  if (pdl.leads.length === 0) {
    console.log('\nNo eligible leads from PDL — aborting.')
    process.exit(0)
  }

  const bc = await runBetterContact(pdl.leads)
  const fm = await runFindymail(pdl.leads)

  // ---------------- Per-lead comparison table ----------------
  console.log('\n=== Per-lead comparison (initials · domain · BC status · FM result) ===')
  console.log('  #  | Lead     | Domain                          | BetterContact       | Findymail')
  console.log('  ---+----------+---------------------------------+---------------------+----------')
  pdl.leads.forEach((l, i) => {
    const key = `${(l.first_name || '').toLowerCase()}|${(l.last_name || '').toLowerCase()}|${(l.domain || '').toLowerCase()}`
    const bcStatus = bc.statusByLead.get(key) || '—'
    const fmStatus = fm.statusByLead.get(key) || '—'
    const idx = String(i + 1).padStart(2, ' ')
    const init = initialsOf(l).padEnd(8, ' ')
    const dom = (l.domain || '(no domain)').padEnd(31, ' ').slice(0, 31)
    const bcCol = bcStatus.padEnd(19, ' ')
    console.log(`  ${idx} | ${init} | ${dom} | ${bcCol} | ${fmStatus}`)
  })

  // Waterfall analysis: on the leads FM attempted, did BC find where FM missed?
  console.log('\n=== Waterfall analysis (BC picks up where FM misses) ===')
  let fmMissBcFound = 0, fmMissBcMiss = 0, bothFound = 0, fmFoundBcMiss = 0
  for (const l of pdl.leads) {
    const key = `${(l.first_name || '').toLowerCase()}|${(l.last_name || '').toLowerCase()}|${(l.domain || '').toLowerCase()}`
    const fmResult = fm.statusByLead.get(key)
    if (!fmResult) continue // FM never attempted this lead
    const bcResult = bc.statusByLead.get(key)
    const bcHit = bcResult === 'valid' || bcResult === 'catch_all_safe'
    const fmHit = fmResult === 'found'
    if (fmHit && bcHit)   bothFound++
    else if (!fmHit && bcHit)  fmMissBcFound++
    else if (fmHit && !bcHit)  fmFoundBcMiss++
    else                        fmMissBcMiss++
  }
  console.log(`  FM found & BC found:      ${bothFound}`)
  console.log(`  FM missed, BC found:      ${fmMissBcFound}   ← incremental value of BC waterfall`)
  console.log(`  FM found, BC missed:      ${fmFoundBcMiss}   ← Findymail-only wins`)
  console.log(`  Both missed:              ${fmMissBcMiss}`)

  // ---------------- Aggregate rates ----------------
  const N = pdl.leads.length
  let bcValid = 0, bcSafe = 0
  for (const v of bc.statusByLead.values()) {
    if (v === 'valid') bcValid++
    else if (v === 'catch_all_safe') bcSafe++
  }
  const bcFindRate       = N > 0 ? Math.round(((bcValid + bcSafe) / N) * 100) : 0
  const bcFindRateStrict = N > 0 ? Math.round((bcValid / N) * 100) : 0

  console.log('\n=== BetterContact aggregate ===')
  console.log(`  Submitted:                 ${N}`)
  console.log(`  Valid:                     ${bcValid}`)
  console.log(`  Catch-all safe:            ${bcSafe}`)
  console.log(`  Find rate (valid + safe):  ${bcFindRate}%`)
  console.log(`  Find rate strict (valid):  ${bcFindRateStrict}%`)
  console.log(`  credits_consumed:          ${bc.credits?.consumed ?? '?'}`)
  console.log(`  credits_left:              ${bc.credits?.left ?? '?'}`)
  if (bc.hitHardStop) console.log(`  ⚠ Hard stop triggered — figures may be partial.`)
  if (bc.summary) console.log(`  Server summary:            ${JSON.stringify(bc.summary)}`)

  // ---------------- End-to-end cost ----------------
  const bcCredits = Number(bc.credits?.consumed) || 0
  const bcDollars = bcCredits * BC_PRICE_PER_CREDIT
  const fmDollars = (fm.found || 0) * EU_PRICE_FM
  const pdlDollars = pdl.creditsConsumed * EU_PRICE_PDL

  const bcActionable = bcValid + bcSafe
  const totalBcPath = pdlDollars + bcDollars
  const perActionableBcPath = bcActionable > 0 ? totalBcPath / bcActionable : null

  const totalFmPath = pdlDollars + fmDollars
  const perActionableFmPath = fm.found > 0 ? totalFmPath / fm.found : null

  console.log('\n=== End-to-end cost per actionable prospect ===')
  console.log(`  ASSUMPTION: BC $/credit = $${BC_PRICE_PER_CREDIT} · PDL $${EU_PRICE_PDL}/candidate · FM $${EU_PRICE_FM}/find`)
  console.log(`  --- Path A: PDL sourcing → BetterContact enrichment ---`)
  console.log(`    PDL cost:      $${pdlDollars.toFixed(2)} (${pdl.creditsConsumed} × $${EU_PRICE_PDL})`)
  console.log(`    BC cost:       $${bcDollars.toFixed(2)} (${bcCredits} × $${BC_PRICE_PER_CREDIT})`)
  console.log(`    Total:         $${totalBcPath.toFixed(2)} for ${bcActionable} actionable email(s)`)
  console.log(`    $/actionable:  ${perActionableBcPath !== null ? `$${perActionableBcPath.toFixed(2)}` : 'n/a'}`)
  console.log(`  --- Path B: PDL sourcing → Findymail enrichment (5 attempts) ---`)
  console.log(`    PDL cost:      $${pdlDollars.toFixed(2)} (${pdl.creditsConsumed} × $${EU_PRICE_PDL})`)
  console.log(`    FM cost:       $${fmDollars.toFixed(2)} (${fm.found} × $${EU_PRICE_FM})`)
  console.log(`    Total:         $${totalFmPath.toFixed(2)} for ${fm.found} actionable email(s)`)
  console.log(`    $/actionable:  ${perActionableFmPath !== null ? `$${perActionableFmPath.toFixed(2)}` : 'n/a'}`)
  console.log(`  Mirvo target:    $0.40 / prospect`)

  console.log('\nDone.')
})().catch(err => {
  console.error('Script failed:', err.message)
  process.exit(1)
})
