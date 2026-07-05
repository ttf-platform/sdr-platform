import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Route } from 'next'
import type { ArticleMeta } from '@/lib/help/types'
import { CATEGORY_LABELS } from '@/lib/help/types'

export function HelpLayout({
  article,
  children,
  nav,
  locale,
}: {
  article: ArticleMeta
  children: ReactNode
  nav: ReactNode
  locale: string
}) {
  return (
    <div className="min-h-screen bg-[#faf8f5]">
      <header className="border-b border-[#e8e3dc] bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3 text-sm">
          <Link href={`/${locale}/dashboard` as Route} className="text-[#6b5e4e] hover:text-[#1a1a1a] transition-colors hidden sm:inline">
            Dashboard
          </Link>
          <span className="text-[#6b5e4e] hidden sm:inline">/</span>
          <Link href={`/${locale}/help`} className="text-[#6b5e4e] hover:text-[#1a1a1a] transition-colors">
            Help Center
          </Link>
          <span className="text-[#6b5e4e]">/</span>
          <span className="text-[#1a1a1a] font-medium truncate" title={article.title}>{article.title}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#3b6bef] mb-3">
          {CATEGORY_LABELS[article.category] ?? article.category}
        </p>

        <article className="prose prose-neutral max-w-none prose-headings:text-[#1a1a1a] prose-a:text-[#3b6bef] prose-a:no-underline hover:prose-a:underline prose-code:text-[#1a1a1a] prose-code:bg-[#f5f2ee] prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-pre:bg-[#1a1a1a] prose-pre:text-[#f5f2ee]">
          {children}
        </article>

        {nav}

        <div className="mt-12 rounded-xl border border-[#e8e3dc] bg-white p-5 text-sm text-[#4a4a5a]">
          <p>
            Still stuck?{' '}
            <Link href={`/${locale}/dashboard` as Route} className="text-[#3b6bef] underline">
              Open the AI assistant
            </Link>{' '}
            in your dashboard (bottom-right help button).
          </p>
        </div>
      </main>
    </div>
  )
}
