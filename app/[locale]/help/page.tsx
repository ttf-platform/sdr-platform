import type { Metadata, Route } from 'next'
import Link from 'next/link'
import { setRequestLocale } from 'next-intl/server'
import { getArticles } from '@/lib/help/getArticles'
import { HelpIndex } from '@/components/help/HelpIndex'

export const metadata: Metadata = {
  title: 'Help Center — Mirvo',
  description: 'Guides and documentation to help you get the most out of Mirvo',
  metadataBase: new URL('https://mirvo.ai'),
  alternates: { canonical: '/help' },
}

export default async function HelpPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const articles = getArticles()

  return (
    <div className="min-h-screen bg-[#faf8f5]">
      <header className="border-b border-[#e8e3dc] bg-white">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link
            href={`/${locale}/dashboard` as Route}
            className="text-sm text-[#6b5e4e] hover:text-[#1a1a1a] transition-colors"
          >
            <span aria-hidden="true">←</span> Back to dashboard
          </Link>
          <Link href={`/${locale}`} className="text-base font-bold text-[#1a1a1a]">
            Mir<span className="text-[#2563eb]">vo</span>
          </Link>
          <div className="w-32" />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-semibold text-[#1a1a1a]">Help Center</h1>
          <p className="text-base text-[#4a4a5a] mt-2">
            Guides and documentation to get the most out of Mirvo.
          </p>
        </div>

        <HelpIndex articles={articles} locale={locale} />

        <p className="mt-10 text-center text-sm text-[#6b5e4e]">
          Still stuck?{' '}
          <Link href={`/${locale}/dashboard` as Route} className="text-[#2563eb] underline">
            Open the AI assistant
          </Link>{' '}
          in your dashboard.
        </p>
      </main>
    </div>
  )
}
