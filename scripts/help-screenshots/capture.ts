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
import * as fs from 'fs'
import * as path from 'path'

const BASE_URL = 'http://localhost:3000'
const OUT_DIR = path.join(process.cwd(), 'public', 'help', 'screenshots')
const MANIFEST_FILE = path.join(process.cwd(), 'scripts', 'help-screenshots', 'manifest.json')
const STATE_FILE = path.join(process.cwd(), 'scripts', 'help-screenshots', '.seed-state.json')

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
  console.log('  🔑 Logging in via UI…')

  await page.goto(`${BASE_URL}/en/login`, { waitUntil: 'networkidle', timeout: 30_000 })
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('button[type="submit"]')

  // Wait for redirect to /dashboard or /en/dashboard
  await page.waitForURL(/dashboard/, { timeout: 20_000 })
  console.log('  ✅ Logged in')
}

async function capture(page: Page, entry: ManifestEntry, outPath: string): Promise<void> {
  const url = `${BASE_URL}${entry.target_url}`
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })

  // Wait for main content to load (sidebar or dashboard content)
  await page.waitForSelector('main, [role="main"], .dashboard-content, nav', { timeout: 10_000 }).catch(() => {})

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
