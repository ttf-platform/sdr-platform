#!/usr/bin/env node
// Throwaway test script v2 — PDL Person Search + Findymail waterfall.
// Run: node --env-file=.env.local scripts/batch-test-providers-v2.mjs
//
// Goal of v2 vs v1: measure the REAL end-to-end cost by exploiting the emails
// PDL already returns, and only spending Findymail credits on the remainder.
//
// STRICT budget (do NOT exceed):
//   PDL free      = ~68 lookups left this month → this run caps at 24 (3 × size=8)
//   PDL rate      = 10 req/min                  → sleeps 7s between calls
//   Findymail     = 5 finder credits left       → this run caps at 5 attempts,
//                                                 ONLY on candidates with no PDL email
//
// Security:
//   - Never logs API keys.
//   - No PII written to disk; aggregated counters → stdout only.
//   - Email presence logged as booleans, never the email value itself.

const PDL_KEY  = process.env.PEOPLEDATALABS_API_KEY
const FM_KEY   = process.env.FINDYMAIL_API_KEY

if (!PDL_KEY || !FM_KEY) {
  console.error('Missing PEOPLEDATALABS_API_KEY or FINDYMAIL_API_KEY in env. Run with: node --env-file=.env.local scripts/batch-test-providers-v2.mjs')
  process.exit(1)
}

const PDL_URL = 'https://api.peopledatalabs.com/v5/person/search'
const FM_URL  = 'https://app.findymail.com/api/search/name'

const EU_COUNTRIES = ['france', 'united kingdom', 'germany']
const EU_PRICE_PDL = 0.28    // $/candidate returned (billed even if email absent)
const EU_PRICE_FM  = 0.05    // $/email found

const SIZE = 8
const PDL_SLEEP_MS = 7000    // ≥ 6s to stay under 10 req/min
const FM_SLEEP_MS  = 1500
const FM_MAX       = 5       // hard cap — 5 credits left on Findymail

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// PDL Person Search queries — reuse v1's first 3 (drop broad SDR to stay ≤ 24).
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
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(obj, maxLen = 600) {
  const s = JSON.stringify(obj, null, 2)
  return s.length > maxLen ? s.slice(0, maxLen) + '…[truncated]' : s
}

// Return a truthy string only if the value is a real non-empty string.
function isRealEmail(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.includes('@')
}

// Inspect the PDL record and classify what emails (if any) are actually present.
// Never returns the email value — only presence booleans + a coarse class.
function classifyPdlEmails(p) {
  const workEmailPresent    = isRealEmail(p.work_email)
  const recPersonalPresent  = isRealEmail(p.recommended_personal_email)
  const personalArr         = Array.isArray(p.personal_emails) ? p.personal_emails : []
  const personalFirstPresent = personalArr.length > 0 && isRealEmail(personalArr[0])
  const emailsArr           = Array.isArray(p.emails) ? p.emails : []
  const emailsFirstPresent  = emailsArr.length > 0 && (
    (typeof emailsArr[0] === 'string' && isRealEmail(emailsArr[0])) ||
    (typeof emailsArr[0] === 'object' && isRealEmail(emailsArr[0]?.address))
  )

  const hasAnyEmail = workEmailPresent || recPersonalPresent || personalFirstPresent || emailsFirstPresent

  let cls
  if (workEmailPresent)      cls = 'pdl_has_work_email'
  else if (hasAnyEmail)      cls = 'pdl_has_any_email'
  else                       cls = 'pdl_no_email'

  return {
    cls,
    presence: {
      work_email:                 workEmailPresent,
      recommended_personal_email: recPersonalPresent,
      personal_emails_first:      personalFirstPresent,
      personal_emails_count:      personalArr.length,
      emails_first:               emailsFirstPresent,
      emails_count:               emailsArr.length,
    },
  }
}

function summariseCandidate(p) {
  const country = (p.location_country || p.location_name || '').toString().toLowerCase()
  const isEU = EU_COUNTRIES.some(c => country.includes(c))
  const hasTitle    = Boolean(p.job_title)
  const hasCompany  = Boolean(p.job_company_name)
  const hasLinkedin = Boolean(p.linkedin_url || p.linkedin_username)
  const email = classifyPdlEmails(p)
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
    emailClass:    email.cls,
    emailPresence: email.presence,
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

  // For debugging: log the first candidate's email-field presence per class
  // so we can SEE whether PDL actually returns emails or empty fields.
  const firstOfClassLogged = { pdl_has_work_email: false, pdl_has_any_email: false, pdl_no_email: false }

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
        for (const p of json.data) {
          const c = summariseCandidate(p)
          allCandidates.push(c)

          // Log first candidate per class — presence booleans only, no email values.
          if (!firstOfClassLogged[c.emailClass]) {
            firstOfClassLogged[c.emailClass] = true
            console.log(`  [PDL sample · ${c.emailClass}] email-field presence (redacted):`)
            console.log(`    ${JSON.stringify(c.emailPresence)}`)
          }
        }
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
  const workEmailCount = allCandidates.filter(c => c.emailClass === 'pdl_has_work_email').length
  const anyEmailCount  = allCandidates.filter(c => c.emailClass === 'pdl_has_any_email').length
  const noEmailCount   = allCandidates.filter(c => c.emailClass === 'pdl_no_email').length
  const anyOrWork      = workEmailCount + anyEmailCount
  const pct = (num) => n > 0 ? `${Math.round((num / n) * 100)}%` : 'n/a'

  console.log('\n--- PDL summary ---')
  console.log(`  Queries OK / failed:            ${PDL_QUERIES.length - queriesFailed} / ${queriesFailed}`)
  console.log(`  Candidates returned:            ${n}`)
  console.log(`  % located in EU:                ${pct(euCount)} (${euCount}/${n})`)
  console.log(`  % title+company+linkedin:       ${pct(fullyComplete)} (${fullyComplete}/${n})`)
  console.log(`  Credits consumed (≈):           ${creditsConsumed}`)
  console.log('  --- Email coverage from PDL ---')
  console.log(`  % with work_email:              ${pct(workEmailCount)} (${workEmailCount}/${n})`)
  console.log(`  % with any email (non-work):    ${pct(anyEmailCount)} (${anyEmailCount}/${n})`)
  console.log(`  % with ANY exploitable email:   ${pct(anyOrWork)} (${anyOrWork}/${n})`)
  console.log(`  % with NO email at all:         ${pct(noEmailCount)} (${noEmailCount}/${n})`)

  return { candidates: allCandidates, pdlCreditsConsumed: creditsConsumed, workEmailCount, anyEmailCount, noEmailCount }
}

// ---------------------------------------------------------------------------
// Findymail — ONLY on pdl_no_email candidates.
// ---------------------------------------------------------------------------

function deriveDomain(c) {
  if (c.domain) {
    try {
      return new URL(c.domain.startsWith('http') ? c.domain : `https://${c.domain}`).hostname.replace(/^www\./, '')
    } catch {
      return null
    }
  }
  return null
}

async function runFindymail(candidates) {
  console.log('\n=== Findymail — find-email-by-name (waterfall on pdl_no_email only) ===')

  // Pool: candidates with NO email from PDL + name + domain.
  const pool = candidates
    .filter(c => c.emailClass === 'pdl_no_email')
    .filter(c => c.full_name && (c.hasCompany || deriveDomain(c)))
    .slice(0, FM_MAX)

  console.log(`  Pool size (pdl_no_email with usable name+domain): ${pool.length}`)
  console.log(`  Hard cap for this run: ${FM_MAX} attempts (Findymail budget)`)

  if (pool.length === 0) {
    console.log('  No eligible candidates in the waterfall pool. Skipping Findymail.')
    return { attempted: 0, found: 0 }
  }

  let attempted = 0
  let found     = 0
  let creditsConsumed = 0
  let firstRawLogged  = false

  for (const c of pool) {
    if (attempted >= FM_MAX) break
    const domain = deriveDomain(c)
    if (!domain) continue
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
  console.log('Batch test v2 — PDL Person Search + Findymail waterfall (only where PDL has no email)')
  console.log(`Caps: PDL ≤ 24 candidates · Findymail ≤ ${FM_MAX} attempts (5 credits left)`)

  const { candidates, pdlCreditsConsumed, workEmailCount, anyEmailCount, noEmailCount } = await runPDL()
  const fm = await runFindymail(candidates)

  // ---------------- Cost extrapolation — two scenarios ----------------
  const N = candidates.length
  const pdlEmailCount = workEmailCount + anyEmailCount   // exploitable from PDL alone
  const found = fm?.found ?? 0
  const pdlCost = N * EU_PRICE_PDL

  console.log('\n=== Cost extrapolation (paid-tier prices) ===')
  console.log('CAVEAT: PDL bills 1 credit per candidate RETURNED, even if the email is')
  console.log('        absent or masked. If PDL doesn\'t deliver exploitable emails, the')
  console.log('        entire PDL spend is still owed on all returned candidates.')

  // Scenario A — PDL emails count as actionable (waterfall reality)
  const actionableA = pdlEmailCount + found
  const fmCostA     = found * EU_PRICE_FM
  const totalA      = pdlCost + fmCostA
  const perActionA  = actionableA > 0 ? totalA / actionableA : null
  const yieldA      = N > 0 ? Math.round((actionableA / N) * 100) : 0

  console.log('\n--- Scenario A: PDL email inclus (waterfall) ---')
  console.log(`  Actionable emails: ${actionableA} = ${pdlEmailCount} from PDL + ${found} from Findymail`)
  console.log(`  Total cost:        $${totalA.toFixed(2)} = $${pdlCost.toFixed(2)} PDL + $${fmCostA.toFixed(2)} FM`)
  console.log(`  Cost / actionable: ${perActionA !== null ? `$${perActionA.toFixed(2)}` : 'n/a'}`)
  console.log(`  End-to-end yield:  ${yieldA}% (${actionableA}/${N} PDL candidates converted to actionable emails)`)

  // Scenario B — Findymail systematique (ignorer les emails PDL, tenter FM sur tous)
  // Modélisation: on suppose que le find-rate observé sur pdl_no_email s'appliquerait
  // à l'ensemble N. On extrapole donc les finds à N × observed_rate.
  const observedRate = fm?.attempted > 0 ? found / fm.attempted : 0
  const projectedFinds = Math.round(N * observedRate)
  const fmCostB = projectedFinds * EU_PRICE_FM
  const totalB  = pdlCost + fmCostB
  const perActionB = projectedFinds > 0 ? totalB / projectedFinds : null
  const yieldB     = N > 0 ? Math.round((projectedFinds / N) * 100) : 0

  console.log('\n--- Scenario B: Findymail systematique (ignore PDL emails) ---')
  console.log(`  Projected finds:   ${projectedFinds} = ${N} × ${(observedRate * 100).toFixed(0)}% observed FM rate`)
  console.log(`  Total cost:        $${totalB.toFixed(2)} = $${pdlCost.toFixed(2)} PDL + $${fmCostB.toFixed(2)} FM`)
  console.log(`  Cost / actionable: ${perActionB !== null ? `$${perActionB.toFixed(2)}` : 'n/a'}`)
  console.log(`  End-to-end yield:  ${yieldB}% (${projectedFinds}/${N})`)

  console.log('\n=== Decision hint ===')
  if (pdlEmailCount === 0) {
    console.log('  PDL delivered 0 exploitable emails on this sample.')
    console.log('  → Scenario A is meaningless; Scenario B is the true cost floor.')
  } else if (pdlEmailCount / N >= 0.5) {
    console.log(`  PDL already covers ${Math.round((pdlEmailCount / N) * 100)}% of the sample — waterfall is winning.`)
  } else {
    console.log(`  PDL covers ${Math.round((pdlEmailCount / N) * 100)}% only — waterfall still helpful but check Scenario A/B delta.`)
  }

  console.log('\nDone.')
})().catch(err => {
  console.error('Script failed:', err.message)
  process.exit(1)
})
