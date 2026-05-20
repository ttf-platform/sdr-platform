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
      router.replace(pathname, { locale: next })
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
            'px-2 py-1 rounded text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-1 ' +
            (isPending ? 'opacity-50 cursor-wait ' : '') +
            (l === locale
              ? 'text-[#1a1a1a] bg-[#e8e3dc]'
              : 'text-[#8a7e6e] hover:text-[#1a1a1a]')
          }
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
