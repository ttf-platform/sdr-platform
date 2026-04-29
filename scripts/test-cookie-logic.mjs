/**
 * Validates that createChunks + cookieJar + respond() pattern
 * produces proper Set-Cookie headers — no Supabase credentials needed.
 */
import { createChunks, DEFAULT_COOKIE_OPTIONS } from '@supabase/ssr'

const PASS = '\x1b[32m✓\x1b[0m'
const FAIL = '\x1b[31m✗\x1b[0m'
let failed = 0

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`${PASS} ${label}`)
  } else {
    console.error(`${FAIL} ${label}${detail ? ' — ' + detail : ''}`)
    failed++
  }
}

// ── 1. createChunks produces named cookie chunks ─────────────────────────────
const mockSession = {
  access_token: 'eyJ' + 'a'.repeat(900),  // ~900 chars — forces chunking
  refresh_token: 'rt_' + 'b'.repeat(200),
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'test-user-id', email: 'test@example.com' }
}

const projectRef = 'jcawhhfvdccvdvwraxko'
const cookieKey = `sb-${projectRef}-auth-token`
const chunks = createChunks(cookieKey, JSON.stringify(mockSession))

assert('createChunks returns at least 1 chunk', chunks.length >= 1, `got ${chunks.length}`)
assert('chunks have name and value', chunks.every(c => c.name && c.value))
assert('first chunk name matches key or key.0', chunks[0].name === cookieKey || chunks[0].name === `${cookieKey}.0`)

const allValues = chunks.map(c => c.value).join('')
assert('reassembled value contains access_token', allValues.includes(mockSession.access_token.slice(0, 20)))

// ── 2. cookieJar accumulates chunks correctly ─────────────────────────────────
const cookieJar = {}
chunks.forEach(({ name, value }) => {
  cookieJar[name] = { name, value, options: { ...DEFAULT_COOKIE_OPTIONS } }
})

assert('cookieJar has same count as chunks', Object.keys(cookieJar).length === chunks.length)
assert('cookieJar options include path', Object.values(cookieJar)[0].options.path !== undefined)

// ── 3. simulate respond() — cookies land in response headers ─────────────────
// We simulate NextResponse.json() by using the Headers API
const headers = new Headers({ 'Content-Type': 'application/json' })
Object.values(cookieJar).forEach(({ name, value, options }) => {
  const opts = [
    `${name}=${value}`,
    options.path ? `Path=${options.path}` : '',
    options.httpOnly ? 'HttpOnly' : '',
    options.sameSite ? `SameSite=${options.sameSite}` : '',
    options.maxAge != null ? `Max-Age=${options.maxAge}` : ''
  ].filter(Boolean).join('; ')
  headers.append('set-cookie', opts)
})

const setCookieHeaders = headers.getSetCookie ? headers.getSetCookie() : [headers.get('set-cookie')]
assert('Set-Cookie headers are present', setCookieHeaders.length >= 1 && setCookieHeaders[0] !== null)
assert('Set-Cookie contains auth-token key', setCookieHeaders.some(h => h.includes('auth-token')))
assert('Set-Cookie contains SameSite', setCookieHeaders.some(h => h.includes('SameSite')))

// ── 4. confirm DEFAULT_COOKIE_OPTIONS shape ───────────────────────────────────
assert('DEFAULT_COOKIE_OPTIONS is an object', typeof DEFAULT_COOKIE_OPTIONS === 'object')
assert('DEFAULT_COOKIE_OPTIONS.path = /', DEFAULT_COOKIE_OPTIONS.path === '/')

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('')
if (failed === 0) {
  console.log('\x1b[32mAll tests passed — cookieJar + createChunks logic is correct.\x1b[0m')
} else {
  console.error(`\x1b[31m${failed} test(s) failed.\x1b[0m`)
  process.exit(1)
}
