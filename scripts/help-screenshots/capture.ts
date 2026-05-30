/**
 * Playwright screenshot capture for help center articles.
 * Run: npx tsx scripts/help-screenshots/capture.ts
 *
 * Prereqs:
 *   1. npx tsx scripts/help-screenshots/seed.ts  (creates test account + .seed-state.json)
 *   2. Dev server running on localhost:3000
 *   3. npx playwright install chromium (if not already installed)
 */
import { chromium, type Browser, type Page } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const BASE_URL = 'http://localhost:3000'
const OUT_DIR = path.join(process.cwd(), 'public', 'help', 'screenshots')
const MANIFEST_FILE = path.join(process.cwd(), 'scripts', 'help-screenshots', 'manifest.json')
const STATE_FILE = path.join(process.cwd(), 'scripts', 'help-screenshots', '.seed-state.json')

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface ManifestEntry {
  article_slug: string
  index: number
  alt: string
  caption: string
  file: string
  target_url: string
  state_required: string
  skip_reason: string
}

async function login(page: Page, email: string, password: string): Promise<void> {
  console.log('  🔑 Injecting session cookie…')

  // Sign in from Node.js, inject cookie — avoids Playwright UI login timing issues
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`Supabase login failed: ${error?.message}`)

  const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`

  await page.context().addCookies([{
    name:     cookieName,
    value:    JSON.stringify(data.session),
    domain:   'localhost',
    path:     '/',
    httpOnly: false,
    secure:   false,
    sameSite: 'Lax',
  }])

  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle', timeout: 30_000 })
  if (!page.url().includes('/dashboard')) {
    throw new Error(`Session injection failed — redirected to: ${page.url()}`)
  }
  console.log('  ✅ Logged in via session injection')
}

async function dismissOverlays(page: Page): Promise<void> {
  // Cookie banner — click "Reject analytics" if present
  const reject = page.getByRole('button', { name: 'Reject analytics' })
  if (await reject.isVisible().catch(() => false)) {
    await reject.click().catch(() => {})
    await page.waitForTimeout(200)
  }
  // Welcome modal — click "Let's go" if present
  const letsGo = page.getByRole('button', { name: /Let's go/i })
  if (await letsGo.isVisible().catch(() => false)) {
    await letsGo.click().catch(() => {})
    await page.waitForTimeout(300)
  }
}

async function capture(page: Page, entry: ManifestEntry, outPath: string): Promise<void> {
  const url = `${BASE_URL}${entry.target_url}`
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })

  // Wait for main content to load (sidebar or dashboard content)
  await page.waitForSelector('main, [role="main"], .dashboard-content, nav', { timeout: 10_000 }).catch(() => {})

  await dismissOverlays(page)

  // Small stabilization delay for animations/hydration
  await page.waitForTimeout(800)

  await page.screenshot({
    path: outPath,
    fullPage: false,
    clip: { x: 0, y: 0, width: 1440, height: 900 },
  })
}

async function main() {
  if (!fs.existsSync(STATE_FILE)) {
    console.error('❌ .seed-state.json not found — run seed.ts first')
    process.exit(1)
  }
  if (!fs.existsSync(MANIFEST_FILE)) {
    console.error('❌ manifest.json not found — run inventory.ts first')
    process.exit(1)
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  const manifest: ManifestEntry[] = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'))

  const capturable = manifest.filter(e => !e.skip_reason)
  const skipped = manifest.filter(e => e.skip_reason)

  console.log(`📸 Capturing ${capturable.length} screenshots (${skipped.length} skipped)`)
  console.log(`   workspaceId: ${state.workspaceId}`)
  console.log(`   campaignId:  ${state.campaignId}`)

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

  const browser: Browser = await chromium.launch({ headless: true })
  const page: Page = await browser.newPage()
  await page.setViewportSize({ width: 1440, height: 900 })

  try {
    await login(page, 'screenshots-bot@mirvo.test', 'screenshots-test-2026!')

    let captured = 0
    let failed = 0

    for (const entry of capturable) {
      const outPath = path.join(OUT_DIR, entry.file)
      process.stdout.write(`  [${entry.article_slug}:${entry.index}] ${entry.file} … `)

      try {
        await capture(page, entry, outPath)
        console.log('✅')
        captured++
      } catch (err) {
        console.log(`❌  ${(err as Error).message.slice(0, 80)}`)
        failed++
      }
    }

    console.log(`\n📊 Results: ${captured} captured, ${failed} failed, ${skipped.length} skipped`)
    if (skipped.length) {
      console.log('\n⏭️  Skipped:')
      skipped.forEach(e => console.log(`   ${e.file}: ${e.skip_reason}`))
    }
  } finally {
    await browser.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
