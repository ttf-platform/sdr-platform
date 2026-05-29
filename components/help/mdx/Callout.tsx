import type { ReactNode } from 'react'

const VARIANTS = {
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    icon: 'ℹ',
    iconColor: 'text-[#2563eb]',
    textColor: 'text-[#1e3a8a]',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: '⚠',
    iconColor: 'text-amber-600',
    textColor: 'text-amber-900',
  },
  tip: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    icon: '✓',
    iconColor: 'text-green-600',
    textColor: 'text-green-900',
  },
}

export function Callout({
  type = 'info',
  children,
}: {
  type?: 'info' | 'warning' | 'tip'
  children: ReactNode
}) {
  const v = VARIANTS[type]
  return (
    <div className={`my-5 flex gap-3 rounded-lg border ${v.bg} ${v.border} px-4 py-3`}>
      <span className={`mt-0.5 flex-shrink-0 text-sm font-bold ${v.iconColor}`}>{v.icon}</span>
      <div className={`text-sm leading-relaxed ${v.textColor}`}>{children}</div>
    </div>
  )
}
