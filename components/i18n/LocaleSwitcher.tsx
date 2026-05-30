'use client'
import { useLocale } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/routing'
import { useTransition } from 'react'

export function LocaleSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  function switchLocale(next: string) {
    startTransition(() => {
      router.replace(pathname, { locale: next as 'en' | 'fr' })
      router.refresh()
    })
  }

  const labels: Record<string, string> = { en: 'English', fr: 'Français' }

  return (
    <div className="flex items-center gap-1" aria-label="Language switcher">
      {(['en', 'fr'] as const).map((l) => (
        <button
          key={l}
          onClick={() => switchLocale(l)}
          disabled={isPending}
          aria-pressed={l === locale}
          aria-label={labels[l]}
          className={
            'min-h-[44px] min-w-[44px] px-3 flex items-center justify-center rounded text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-1 ' +
            (isPending ? 'opacity-50 cursor-wait ' : '') +
            (l === locale
              ? 'text-[#1a1a1a] bg-[#e8e3dc]'
              : 'text-[#6b5e4e] hover:text-[#1a1a1a]')
          }
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
