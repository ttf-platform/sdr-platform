import * as cheerio from 'cheerio'
import { assertPublicUrl } from './ssrf-guard'

const SCRAPE_TIMEOUT = 8000
const MAX_HTML_SIZE  = 500_000
const PAGES_TO_TRY   = ['/', '/pricing', '/about']

export interface ScrapedContent {
  url:       string
  pages:     { path: string; text: string }[]
  totalText: string
}

export async function scrapeWebsite(rawUrl: string): Promise<ScrapedContent | null> {
  const url = normalizeUrl(rawUrl)
  if (!url) return null

  const pages: { path: string; text: string }[] = []

  for (const path of PAGES_TO_TRY) {
    try {
      const fullUrl = new URL(path, url).toString()
      const html    = await fetchWithTimeout(fullUrl, SCRAPE_TIMEOUT)
      if (!html) continue

      const text = extractTextContent(html)
      if (text.length < 100) continue

      pages.push({ path, text: text.slice(0, 5000) })
    } catch {
      // 404 / network error — try next page
    }
  }

  if (pages.length === 0) return null

  const totalText = pages
    .map(p => `--- ${p.path} ---\n${p.text}`)
    .join('\n\n')

  return { url, pages, totalText }
}

function normalizeUrl(input: string): string | null {
  let url = input.trim()
  if (!url) return null
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

async function fetchWithTimeout(url: string, ms: number): Promise<string | null> {
  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), ms)
  try {
    let current = url
    for (let hop = 0; hop < 4; hop++) {
      // SSRF guard : re-valide avant chaque requête, y compris chaque redirection
      await assertPublicUrl(current)
      const res = await fetch(current, {
        signal:   controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MirvoBot/1.0)',
          'Accept':     'text/html,application/xhtml+xml',
        },
        redirect: 'manual',
      })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) return null
        current = new URL(loc, current).toString()
        continue
      }
      if (!res.ok) return null
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('text/html')) return null
      const text = await res.text()
      return text.slice(0, MAX_HTML_SIZE)
    }
    return null // trop de redirections
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function extractTextContent(html: string): string {
  const $ = cheerio.load(html)
  $('script, style, noscript, iframe, svg, nav, footer, header').remove()

  const main    = $('main').first()
  const article = $('article').first()

  let text = ''
  if (main.length)    text = main.text()
  else if (article.length) text = article.text()
  else                text = $('body').text()

  return text.replace(/\s+/g, ' ').trim()
}
