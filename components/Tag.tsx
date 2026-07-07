'use client'
import { useTranslations } from 'next-intl'
import { getTagColorClasses } from '@/lib/tag-colors'

interface TagProps {
  label:    string
  color:    string
  onRemove?: () => void
  size?:    'sm' | 'md'
}

export function Tag({ label, color, onRemove, size = 'sm' }: TagProps) {
  const t         = useTranslations('components.tags')
  const cls       = getTagColorClasses(color)
  const sizeCls   = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${cls.bg} ${cls.text} ${cls.border} ${sizeCls}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cls.dot}`} />
      {label}
      {onRemove && (
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          className="ml-0.5 hover:opacity-70 leading-none"
          aria-label={t('removeAriaLabel', { label })}
        >
          ×
        </button>
      )}
    </span>
  )
}
