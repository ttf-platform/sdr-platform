/**
 * Generate a reusable Playwright storageState with an authenticated Supabase
 * session + the dashboard-locale cookie, for use across i18n E2E lots.
 *
 * Run: npm run pw:auth   (or: node scripts/playwright-auth.mjs)
 *
 * Reads credentials from scripts/help-screenshots/.seed-state.json (same
 * source consumed by scripts/help-screenshots/capture.ts). If the seed file
 * is missing, run `npm run help:seed` first.
 *
 * Env vars:
 *   LOCALE     dashboard locale to inject as cookie (default: 'fr')
 *   BASE_URL   dev server URL (default: 'http://localhost:3000')
 *
 * Output: scripts/.playwright-auth.json  (gitignored — contains a live token).
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import * as fs from 'node:fs'
import * as path from 'node:path'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const BASE_URL      = process.env.BASE_URL || 'http://localhost:3000'
const LOCALE        = (process.env.LOCALE || 'fr').toLowerCase()
const STATE_FILE    = path.join(process.cwd(), 'scripts', 'help-screenshots', '.seed-state.json')
const OUT_FILE      = path.join(process.cwd(), 'scripts', '.playwright-auth.json')
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function mask(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return '<invalid>'
  const [local, domain] = email.split('@')
  return `${local.slice(0, 1)}***@${'*'.repeat(Math.max(domain.length, 3))}`
}

function fail(msg) {
  console.error(`❌ ${msg}`)
  process.exit(1)
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    fail('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local')
  }
  if (!['fr', 'en'].includes(LOCALE)) {
    fail(`LOCALE must be 'fr' or 'en' — got '${LOCALE}'`)
  }
  if (!fs.existsSync(STATE_FILE)) {
    fail(`Seed state not found — run \`npm run help:seed\` first (expected: ${STATE_FILE})`)
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  if (!state.email || !state.password) {
    fail('.seed-state.json missing email/password — re-run `npm run help:seed`')
  }

  console.log(`🔑 pw:auth  →  locale=${LOCALE}  target=${BASE_URL}`)
  console.log(`   logging in as ${mask(state.email)}`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({
    email:    state.email,
    password: state.password,
  })
  if (error || !data.session) {
    fail(`Supabase login failed: ${error?.message || 'no session returned'} — try \`npm run help:seed\` to reset the test account`)
  }
  console.log('   ✅ Supabase signInWithPassword OK')

  const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  try {
    await context.addCookies([
      {
        name:     cookieName,
        value:    JSON.stringify(data.session),
        domain:   'localhost',
        path:     '/',
        httpOnly: false,
        secure:   false,
        sameSite: 'Lax',
      },
      {
        name:     'mirvo_dashboard_locale',
        value:    LOCALE,
        domain:   'localhost',
        path:     '/',
        httpOnly: false,
        secure:   false,
        sameSite: 'Lax',
      },
    ])

    const page = await context.newPage()
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const landedOn = page.url()
    if (!landedOn.includes('/dashboard')) {
      fail(`Session injection failed — /dashboard redirected to: ${landedOn}`)
    }
    console.log(`   ✅ /dashboard reachable (landed: ${landedOn})`)

    await context.storageState({ path: OUT_FILE })
    console.log(`   ✅ storageState saved → ${path.relative(process.cwd(), OUT_FILE)}`)
    console.log('\n✅ pw:auth done. Consume via:')
    console.log(`     await chromium.launchPersistentContext(..., { storageState: '${path.relative(process.cwd(), OUT_FILE)}' })`)
    console.log(`   or:`)
    console.log(`     const context = await browser.newContext({ storageState: '${path.relative(process.cwd(), OUT_FILE)}' })`)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('❌ pw:auth failed:', e?.message || e)
  process.exit(1)
})
