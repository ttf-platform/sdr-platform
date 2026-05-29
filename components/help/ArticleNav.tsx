import Link from 'next/link'
import type { ArticleMeta } from '@/lib/help/types'

export function ArticleNav({
  prev,
  next,
  locale,
}: {
  prev: ArticleMeta | null
  next: ArticleMeta | null
  locale: string
}) {
  return (
    <nav
      className="mt-12 flex items-center justify-between border-t border-[#e8e3dc] pt-6"
      aria-label="Article navigation"
    >
      <div>
        {prev && (
          <Link
            href={`/${locale}/help/${prev.slug}`}
            className="group flex flex-col text-sm text-[#6b5e4e] hover:text-[#1a1a1a]"
          >
            <span className="text-xs text-[#6b5e4e]">Previous</span>
            <span className="group-hover:underline">{prev.title}</span>
          </Link>
        )}
      </div>
      <div className="text-right">
        {next && (
          <Link
            href={`/${locale}/help/${next.slug}`}
            className="group flex flex-col text-sm text-[#6b5e4e] hover:text-[#1a1a1a]"
          >
            <span className="text-xs text-[#6b5e4e]">Next</span>
            <span className="group-hover:underline">{next.title}</span>
          </Link>
        )}
      </div>
    </nav>
  )
}
