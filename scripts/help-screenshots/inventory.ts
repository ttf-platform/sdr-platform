import fs from 'fs'
import path from 'path'

const CONTENT_DIR = path.join(process.cwd(), 'content', 'help')
const OUT_FILE = path.join(process.cwd(), 'scripts', 'help-screenshots', 'manifest.json')

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

const files = fs.readdirSync(CONTENT_DIR)
  .filter(f => f.endsWith('.mdx'))
  .map(f => path.join(CONTENT_DIR, f))
  .sort()
const entries: ManifestEntry[] = []

for (const filepath of files) {
  const slug = path.basename(filepath, '.mdx')
  const text = fs.readFileSync(filepath, 'utf8')
  const re = /<Screenshot\s+placeholder\s+alt='([^']+)'\s+caption='([^']+)'\s*\/>/g
  let m: RegExpExecArray | null
  let i = 1
  while ((m = re.exec(text)) !== null) {
    const alt = m[1]
    const caption = m[2]
    const file = `${slug}-${i}.png`
    entries.push({
      article_slug: slug,
      index: i,
      alt,
      caption,
      file,
      target_url: '',
      state_required: '',
      skip_reason: '',
    })
    i++
  }
}

fs.writeFileSync(OUT_FILE, JSON.stringify(entries, null, 2))
console.log(`✅ manifest.json written — ${entries.length} entries`)
entries.forEach(e => console.log(`  [${e.article_slug}:${e.index}] ${e.alt.slice(0, 70)}`))
