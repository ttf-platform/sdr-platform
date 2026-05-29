import Link from 'next/link'
import type { ArticleMeta, ArticleCategory } from '@/lib/help/types'
import { CATEGORY_LABELS } from '@/lib/help/types'

const CATEGORY_ORDER: ArticleCategory[] = [
  'getting-started',
  'sending-infrastructure',
  'campaigns',
  'campaigns-ai',
  'signals',
  'approval-sending',
  'replies',
  'billing',
  'troubleshooting',
]

const CATEGORY_ICONS: Partial<Record<ArticleCategory, string>> = {
  'getting-started': '🚀',
  'sending-infrastructure': '📨',
  'campaigns': '🎯',
  'campaigns-ai': '✨',
  'signals': '📡',
  'approval-sending': '✅',
  'replies': '💬',
  'billing': '⚙️',
  'troubleshooting': '🔧',
}

export function HelpIndex({
  articles,
  locale,
}: {
  articles: ArticleMeta[]
  locale: string
}) {
  const grouped = CATEGORY_ORDER.reduce<Record<string, ArticleMeta[]>>((acc, cat) => {
    acc[cat] = articles.filter((a) => a.category === cat)
    return acc
  }, {})

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {CATEGORY_ORDER.map((cat) => {
        const items = grouped[cat]
        if (!items || items.length === 0) return null
        return (
          <div
            key={cat}
            className="bg-white border border-[#e8e3dc] rounded-xl p-5 hover:border-[#2563eb] transition-colors"
          >
            <div className="text-3xl mb-3" aria-hidden="true">{CATEGORY_ICONS[cat] ?? '📄'}</div>
            <h2 className="text-base font-semibold text-[#1a1a1a]">{CATEGORY_LABELS[cat]}</h2>
            <ul className="mt-3 space-y-1.5">
              {items.map((article) => (
                <li key={article.slug}>
                  <Link
                    href={`/${locale}/help/${article.slug}`}
                    className="flex items-center gap-2 text-sm text-[#4a4a5a] hover:text-[#2563eb] transition-colors group"
                  >
                    <span className="text-xs text-[#9a9a9a] group-hover:text-[#2563eb]" aria-hidden="true">→</span>
                    <span className="group-hover:underline">{article.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
