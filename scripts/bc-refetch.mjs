#!/usr/bin/env node
// Throwaway — re-fetch a completed BetterContact enrichment job.
// Run: node --env-file=.env.local scripts/bc-refetch.mjs
//
// Purpose: re-parse the per-lead statuses of a job that already ran, WITHOUT
// spending any credit (GET on a completed job is a plain read, no re-enrichment).
//
// Security:
//   - Never logs API key.
//   - Redacts every string value that looks like an email address, keeping
//     status enums intact (e.g. "valid", "catch_all_safe", "not_found").
//   - No PII written to disk; everything → stdout.

const BC_KEY = process.env.BETTERCONTACT_API_KEY
if (!BC_KEY) {
  console.error('Missing BETTERCONTACT_API_KEY in env. Run with: node --env-file=.env.local scripts/bc-refetch.mjs')
  process.exit(1)
}

const REQUEST_ID = 'd986a3e52f62d077cb7e'
const GET_URL    = `https://app.bettercontact.rocks/api/v2/async/${REQUEST_ID}`

// ---------------------------------------------------------------------------
// Value-level redaction — targets email strings only, preserves status enums.
// ---------------------------------------------------------------------------

const EMAIL_RE = /^\S+@\S+\.\S+$/

function redact(v) {
  if (v === null || v === undefined) return v
  if (typeof v === 'string') return EMAIL_RE.test(v.trim()) ? '<redacted-email>' : v
  if (Array.isArray(v)) return v.map(redact)
  if (typeof v === 'object') {
    const out = {}
    for (const [k, val] of Object.entries(v)) out[k] = redact(val)
    return out
  }
  return v
}

// ---------------------------------------------------------------------------
// Discover-the-shape helpers (do NOT assume field names)
// ---------------------------------------------------------------------------

function firstArrayInside(obj, seen = new Set(), path = '$') {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return null
  seen.add(obj)
  if (Array.isArray(obj)) return { path, arr: obj }
  // BFS: prefer arrays at shallow depths, deprioritize small primitive arrays.
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
      return { path: `${path}.${k}`, arr: v }
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') {
      const nested = firstArrayInside(v, seen, `${path}.${k}`)
      if (nested) return nested
    }
  }
  return null
}

function initialsOf(item) {
  const fn = item.first_name || item.firstname || item.firstName || ''
  const ln = item.last_name  || item.lastname  || item.lastName  || ''
  const f = fn.trim().charAt(0).toUpperCase() || '?'
  const l = ln.trim().charAt(0).toUpperCase() || '?'
  return `${f}.${l}.`
}

// Pull the "status" field for a lead without assuming its exact name.
// Priority order: known BC field names, then any key with "status" or "state".
function pickStatus(item) {
  const known = [
    'contact_email_address_status',
    'email_address_status',
    'email_status',
    'verification_status',
    'status',
    'state',
  ]
  for (const k of known) if (item[k] !== undefined && item[k] !== null) return { key: k, value: item[k] }
  for (const [k, v] of Object.entries(item)) {
    const lk = k.toLowerCase()
    if ((lk.includes('status') || lk.includes('state')) && v !== null && v !== undefined) {
      return { key: k, value: v }
    }
  }
  return null
}

// Pull the provider name (which waterfall step delivered the email).
function pickProvider(item) {
  const known = ['provider', 'source', 'found_by', 'enriched_by', 'waterfall_provider', 'contact_email_address_provider']
  for (const k of known) if (item[k] !== undefined && item[k] !== null && item[k] !== '') return { key: k, value: item[k] }
  for (const [k, v] of Object.entries(item)) {
    const lk = k.toLowerCase()
    if ((lk.includes('provider') || lk.includes('source')) && v !== null && v !== undefined && v !== '') {
      return { key: k, value: v }
    }
  }
  return null
}

function pickDomain(item) {
  return item.company_domain || item.domain || item.website || '(no domain)'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

;(async () => {
  console.log(`Re-fetch BetterContact job ${REQUEST_ID}`)
  console.log('This is a plain GET on a completed job — should NOT consume credits.')

  let res, json = {}
  try {
    res = await fetch(GET_URL, { method: 'GET', headers: { 'X-API-Key': BC_KEY } })
    try { json = await res.json() } catch { /* body may be empty */ }
  } catch (err) {
    console.error('GET failed:', err.message)
    process.exit(1)
  }
  console.log(`HTTP ${res.status}`)

  const redacted = redact(json)

  // 1) Top-level shape
  console.log('\n=== Top-level keys ===')
  console.log(Object.keys(redacted))

  // 2) Full body (redacted, pretty)
  console.log('\n=== Full body (email VALUES redacted, status keys preserved) ===')
  console.log(JSON.stringify(redacted, null, 2))

  // 3) Credits — confirm unchanged (~45 expected)
  const creditsConsumed = json?.credits_consumed ?? json?.data?.credits_consumed ?? null
  const creditsLeft     = json?.credits_left     ?? json?.data?.credits_left     ?? null
  console.log('\n=== Credits ===')
  console.log(`  credits_consumed: ${creditsConsumed ?? '(not present)'}`)
  console.log(`  credits_left:     ${creditsLeft ?? '(not present)'}  ← expected unchanged (~45) since GET on a completed job`)

  // 4) Locate the per-lead array without assuming field names
  const primaryCandidates = [
    { path: '$.data', arr: Array.isArray(json.data) ? json.data : null },
    { path: '$.results', arr: Array.isArray(json.results) ? json.results : null },
    { path: '$.data.results', arr: Array.isArray(json.data?.results) ? json.data.results : null },
    { path: '$.data.data', arr: Array.isArray(json.data?.data) ? json.data.data : null },
  ].filter(x => Array.isArray(x.arr) && x.arr.length > 0 && typeof x.arr[0] === 'object')

  let leadsArr = null, leadsPath = null
  if (primaryCandidates.length > 0) {
    leadsArr = primaryCandidates[0].arr
    leadsPath = primaryCandidates[0].path
  } else {
    const found = firstArrayInside(json)
    if (found) { leadsArr = found.arr; leadsPath = found.path }
  }

  if (!leadsArr) {
    console.log('\n✖ Could not locate a per-lead array in the response.')
    console.log('  Inspect the "Full body" dump above and adjust the picker.')
    return
  }

  console.log(`\n=== Per-lead array located at: ${leadsPath}  (n=${leadsArr.length}) ===`)

  // 5) Print the keys of the first item so we SEE the real field names
  if (leadsArr[0] && typeof leadsArr[0] === 'object') {
    console.log('First-item keys (schema discovery):')
    console.log('  ' + Object.keys(leadsArr[0]).join(', '))
  }

  // 6) Per-lead table — real, discovered fields only
  console.log('\n=== Per-lead statuses ===')
  console.log('  #  | Init  | Domain                          | Status field                  | Status value        | Provider')
  console.log('  ---+-------+---------------------------------+-------------------------------+---------------------+---------')
  leadsArr.forEach((item, i) => {
    const idx  = String(i + 1).padStart(2, ' ')
    const init = initialsOf(item).padEnd(5, ' ')
    const dom  = String(pickDomain(item)).padEnd(31, ' ').slice(0, 31)
    const st   = pickStatus(item)
    const stKey = (st?.key   ?? '—').padEnd(29, ' ').slice(0, 29)
    const stVal = String(st?.value ?? '—').padEnd(19, ' ').slice(0, 19)
    const prov = pickProvider(item)
    const provStr = prov ? `${prov.key}=${prov.value}` : '—'
    console.log(`  ${idx} | ${init} | ${dom} | ${stKey} | ${stVal} | ${provStr}`)
  })

  // 7) Tally the discovered status values
  console.log('\n=== Status tally (based on the discovered status field per lead) ===')
  const tally = {}
  for (const item of leadsArr) {
    const st = pickStatus(item)
    const v = st ? String(st.value).toLowerCase() : '(no status field)'
    tally[v] = (tally[v] || 0) + 1
  }
  for (const [v, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padEnd(24, ' ')} ${n}`)
  }

  // 8) Optional server summary if present
  const summary = json?.summary || json?.counts || json?.data?.summary || json?.data?.counts || null
  if (summary) {
    console.log('\n=== Server-provided summary (echo) ===')
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log('\n(No server-side summary/counts field present.)')
  }

  console.log('\nDone.')
})().catch(err => {
  console.error('Script failed:', err.message)
  process.exit(1)
})
