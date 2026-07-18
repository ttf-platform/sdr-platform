import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { getArticles, getArticle } from '@/lib/help/getArticles'
import { MDX_MODULES } from '@/lib/help/mdxModules'
import { HelpLayout } from '@/components/help/HelpLayout'
import { ArticleNav } from '@/components/help/ArticleNav'
import { FRBanner } from '@/components/help/FRBanner'

export async function generateStaticParams() {
  const articles = getArticles()
  const locales = ['en', 'fr']
  return locales.flatMap((locale) => articles.map((a) => ({ locale, slug: a.slug })))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const article = getArticle(slug)
  if (!article) return {}
  return {
    title: `${article.title} — Mirvo Help`,
    description: article.description,
    metadataBase: new URL('https://www.mirvo.ai'),
  }
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const article = getArticle(slug)
  if (!article) notFound()

  const MDXContent = MDX_MODULES[slug]
  if (!MDXContent) notFound()

  const articles = getArticles()
  const idx = articles.findIndex((a) => a.slug === slug)
  const prev = idx > 0 ? articles[idx - 1] : null
  const next = idx < articles.length - 1 ? articles[idx + 1] : null

  return (
    <HelpLayout
      article={article}
      locale={locale}
      nav={<ArticleNav prev={prev} next={next} locale={locale} />}
    >
      {locale === 'fr' && <FRBanner />}
      <MDXContent />
    </HelpLayout>
  )
}
