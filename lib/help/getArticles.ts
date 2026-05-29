import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import type { ArticleMeta } from './types'

const CONTENT_DIR = path.join(process.cwd(), 'content', 'help')

export function getArticles(): ArticleMeta[] {
  if (!fs.existsSync(CONTENT_DIR)) return []
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.mdx'))
  const articles = files.map((f) => {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8')
    const { data } = matter(raw)
    return data as ArticleMeta
  })
  return articles.sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
}

export function getArticle(slug: string): ArticleMeta | null {
  return getArticles().find((a) => a.slug === slug) ?? null
}

export function getArticleRaw(slug: string): string | null {
  const filePath = path.join(CONTENT_DIR, `${slug}.mdx`)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf8')
}
