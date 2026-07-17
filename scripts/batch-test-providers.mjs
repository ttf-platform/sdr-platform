#!/usr/bin/env node
// Throwaway test script — PDL Person Search + Findymail find-email.
// Run: node --env-file=.env.local scripts/batch-test-providers.mjs
//
// Constraints (do NOT exceed):
//   PDL free      = 100 lookups/month — this run caps at ~32 (4 × size=8)
//   PDL rate      = 10 req/min        — sleeps 7s between calls
//   Findymail    = 10 finder credits  — this run caps at 10 attempts
//
// Security:
//   - Never logs API keys.
//   - No PII written to disk; aggregated counters → stdout only.

const PDL_KEY  = process.env.PEOPLEDATALABS_API_KEY
const FM_KEY   = process.env.FINDYMAIL_API_KEY

if (!PDL_KEY || !FM_KEY) {
  console.error('Missing PEOPLEDATALABS_API_KEY or FINDYMAIL_API_KEY in env. Run with: node --env-file=.env.local scripts/batch-test-providers.mjs')
  process.exit(1)
}

const PDL_URL = 'https://api.peopledatalabs.com/v5/person/search'
const FM_URL  = 'https://app.findymail.com/api/search/name'

const EU_COUNTRIES = ['france', 'united kingdom', 'germany']
const EU_PRICE_PDL = 0.28    // $/candidate (returned)
const EU_PRICE_FM  = 0.05    // $/email found

const SIZE = 8
const PDL_SLEEP_MS = 7000    // ≥ 6s to stay under 10 req/min
const FM_SLEEP_MS  = 1500
const FM_MAX       = 10

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// PDL Person Search queries — Elasticsearch DSL, EU-only, ICP-focused.
// Use location_country (ISO-2) lowercase. job_title is a free-text field;
// use match_phrase to keep results tight.
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
    label: 'marketing / growth agencies (EU)',
    query: {
      bool: {
        must: [
          { terms: { job_title_role: ['marketing'] } },
          { match: { job_company_industry: 'marketing and advertising' } },
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
  {
    label: 'broad EU SDR / outbound',
    query: {
      bool: {
        must: [
          { terms: { job_title_role: ['sales'] } },
          { terms: { location_country: ['france', 'united kingdom', 'germany'] } },
        ],
      },
    },
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(obj, maxLen = 600) {
  const s = JSON.stringify(obj, null, 2)
  return s.length > maxLen ? s.slice(0, maxLen) + '…[truncated]' : s
}

function summariseCandidate(p) {
  const country = (p.location_country || p.location_name || '').toString().toLowerCase()
  const isEU = EU_COUNTRIES.some(c => country.includes(c))
  const hasTitle    = Boolean(p.job_title)
  const hasCompany  = Boolean(p.job_company_name)
  const hasLinkedin = Boolean(p.linkedin_url || p.linkedin_username)
  return {
    full_name: p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
    job_title: p.job_title || null,
    company:   p.job_company_name || null,
    domain:    p.job_company_website || null,
    country,
    isEU,
    hasTitle,
    hasCompany,
    hasLinkedin,
  }
}

// ---------------------------------------------------------------------------
// PDL
// ---------------------------------------------------------------------------

async function runPDL() {
  console.log('\n=== PDL — Person Search ===')
  let allCandidates = []
  let creditsConsumed = 0
  let queriesFailed = 0
  let firstRawLogged = false

  for (let i = 0; i < PDL_QUERIES.length; i++) {
    const q = PDL_QUERIES[i]
    console.log(`\n[PDL q${i + 1}] ${q.label}`)
    try {
      const res = await fetch(PDL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key':    PDL_KEY,
        },
        body: JSON.stringify({ query: q.query, size: SIZE, pretty: false }),
      })
      const json = await res.json()

      if (!firstRawLogged) {
        console.log('[PDL] First raw response (truncated):')
        console.log(truncate({
          status: json.status,
          total:  json.total,
          data_count: Array.isArray(json.data) ? json.data.length : null,
          first_record_keys: Array.isArray(json.data) && json.data[0]
            ? Object.keys(json.data[0]).slice(0, 25)
            : null,
        }))
        firstRawLogged = true
      }

      if (res.status !== 200 || !Array.isArray(json.data)) {
        queriesFailed++
        console.log(`  → HTTP ${res.status} · error: ${json.error?.message ?? json.error ?? 'unknown'}`)
      } else {
        const returned = json.data.length
        creditsConsumed += returned
        console.log(`  → ${returned} candidates returned (total available: ${json.total ?? '?'})`)
        for (const p of json.data) allCandidates.push(summariseCandidate(p))
      }
    } catch (err) {
      queriesFailed++
      console.log(`  → fetch failed: ${err.message}`)
    }

    if (i < PDL_QUERIES.length - 1) {
      console.log(`  (sleep ${PDL_SLEEP_MS / 1000}s for rate limit)`)
      await sleep(PDL_SLEEP_MS)
    }
  }

  const n = allCandidates.length
  const euCount       = allCandidates.filter(c => c.isEU).length
  const fullyComplete = allCandidates.filter(c => c.hasTitle && c.hasCompany && c.hasLinkedin).length
  const pct = (num) => n > 0 ? `${Math.round((num / n) * 100)}%` : 'n/a'

  console.log('\n--- PDL summary ---')
  console.log(`  Queries OK / failed:        ${PDL_QUERIES.length - queriesFailed} / ${queriesFailed}`)
  console.log(`  Candidates returned:        ${n}`)
  console.log(`  % located in EU:            ${pct(euCount)} (${euCount}/${n})`)
  console.log(`  % title+company+linkedin:   ${pct(fullyComplete)} (${fullyComplete}/${n})`)
  console.log(`  Credits consumed (≈):       ${creditsConsumed}`)

  return allCandidates
}

// ---------------------------------------------------------------------------
// Findymail
// ---------------------------------------------------------------------------

function deriveDomain(c) {
  if (c.domain) {
    try {
      // strip protocol + path
      return new URL(c.domain.startsWith('http') ? c.domain : `https://${c.domain}`).hostname.replace(/^www\./, '')
    } catch {
      return null
    }
  }
  return null
}

async function runFindymail(candidates) {
  console.log('\n=== Findymail — find-email-by-name ===')

  // Pool: need full_name + (company OR domain). Prefer those with domain.
  const pool = candidates
    .filter(c => c.full_name && (c.hasCompany || deriveDomain(c)))
    .slice(0, FM_MAX)

  if (pool.length === 0) {
    console.log('  No eligible candidates (need name + domain/company). Skipping.')
    return
  }

  let attempted = 0
  let found     = 0
  let creditsConsumed = 0
  let firstRawLogged  = false

  for (const c of pool) {
    if (attempted >= FM_MAX) break
    const domain = deriveDomain(c)
    if (!domain) {
      // Findymail requires a domain. Skip if absent (some PDL records have company name but no website).
      continue
    }
    attempted++

    try {
      const res = await fetch(FM_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${FM_KEY}`,
        },
        body: JSON.stringify({ name: c.full_name, domain }),
      })
      const json = await res.json().catch(() => ({}))

      if (!firstRawLogged) {
        console.log('[Findymail] First raw response (truncated, email redacted):')
        const redacted = { ...json }
        if (redacted.contact?.email) redacted.contact = { ...redacted.contact, email: '<redacted>' }
        console.log(truncate({ http_status: res.status, top_level_keys: Object.keys(json), shape: redacted }))
        firstRawLogged = true
      }

      const hit = Boolean(json?.contact?.email)
      if (hit) {
        found++
        creditsConsumed++   // 1 credit only if found (per docs)
        console.log(`  [${attempted}] FOUND  · ${c.full_name} @ ${domain}`)
      } else {
        console.log(`  [${attempted}] miss   · ${c.full_name} @ ${domain} (http ${res.status})`)
      }
    } catch (err) {
      console.log(`  [${attempted}] error  · ${err.message}`)
    }

    await sleep(FM_SLEEP_MS)
  }

  const findRate = attempted > 0 ? `${Math.round((found / attempted) * 100)}%` : 'n/a'
  console.log('\n--- Findymail summary ---')
  console.log(`  Attempts:                   ${attempted}`)
  console.log(`  Emails found:               ${found}`)
  console.log(`  Find rate:                  ${findRate}`)
  console.log(`  Credits consumed (≈):       ${creditsConsumed}`)

  return { attempted, found }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

;(async () => {
  console.log('Batch test — PDL Person Search + Findymail find-email')
  console.log('Caps: PDL ≤ 32 candidates · Findymail ≤ 10 finds')

  const candidates = await runPDL()
  const fm = await runFindymail(candidates)

  // Extrapolated cost per actionable prospect
  const pdlCount = candidates.length
  const found    = fm?.found ?? 0
  const pdlCost  = pdlCount * EU_PRICE_PDL
  const fmCost   = found * EU_PRICE_FM
  const totalCost = pdlCost + fmCost
  const perActionable = found > 0 ? totalCost / found : null

  console.log('\n=== Cost extrapolation (paid-tier prices) ===')
  console.log(`  PDL candidates × $${EU_PRICE_PDL}:           $${pdlCost.toFixed(2)} (${pdlCount} × $${EU_PRICE_PDL})`)
  console.log(`  Findymail finds × $${EU_PRICE_FM}:          $${fmCost.toFixed(2)} (${found} × $${EU_PRICE_FM})`)
  console.log(`  Total spent for ${found} actionable prospect(s): $${totalCost.toFixed(2)}`)
  console.log(`  Effective cost per actionable prospect:    ${perActionable !== null ? `$${perActionable.toFixed(2)}` : 'n/a (no email found)'}`)

  console.log('\nDone.')
})().catch(err => {
  console.error('Script failed:', err.message)
  process.exit(1)
})
