import { MetadataRoute } from 'next'

const BASE_URL = 'https://mirvo.ai'
const locales = ['en', 'fr'] as const

type Entry = {
  path: string
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']
  priority: number
  lastModified?: Date
}

const entries: Entry[] = [
  { path: '',                      changeFrequency: 'weekly',  priority: 1.0 },
  { path: '/about',                changeFrequency: 'monthly', priority: 0.7 },
  { path: '/contact',              changeFrequency: 'monthly', priority: 0.7 },
  { path: '/pricing',              changeFrequency: 'weekly',  priority: 0.8 },
  { path: '/legal/privacy',        changeFrequency: 'yearly',  priority: 0.4, lastModified: new Date('2026-05-19') },
  { path: '/legal/terms',          changeFrequency: 'yearly',  priority: 0.4, lastModified: new Date('2026-05-19') },
  { path: '/legal/cookies',        changeFrequency: 'yearly',  priority: 0.4, lastModified: new Date('2026-05-19') },
  { path: '/legal/security',       changeFrequency: 'yearly',  priority: 0.4, lastModified: new Date('2026-05-19') },
  { path: '/legal/sending-policy', changeFrequency: 'yearly',  priority: 0.4, lastModified: new Date('2026-05-19') },
  { path: '/legal/dpa',            changeFrequency: 'yearly',  priority: 0.4, lastModified: new Date('2026-05-19') },
  { path: '/legal/gdpr',           changeFrequency: 'yearly',  priority: 0.4, lastModified: new Date('2026-05-19') },
]

export default function sitemap(): MetadataRoute.Sitemap {
  return locales.flatMap((locale) =>
    entries.map(({ path, changeFrequency, priority, lastModified }) => ({
      url: `${BASE_URL}/${locale}${path}`,
      lastModified: lastModified ?? new Date(),
      changeFrequency,
      priority,
      alternates: {
        languages: Object.fromEntries(
          locales.map((l) => [l, `${BASE_URL}/${l}${path}`])
        ),
      },
    }))
  )
}
