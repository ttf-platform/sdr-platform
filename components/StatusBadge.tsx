const VARIANT_STYLES: Record<string, string> = {
  orange: 'bg-orange-50 text-orange-600 border-orange-200',
  blue:   'bg-blue-50   text-blue-600   border-blue-200',
  green:  'bg-green-50  text-green-600  border-green-200',
  gray:   'bg-gray-50   text-gray-600   border-gray-200',
  purple: 'bg-purple-50 text-purple-600 border-purple-200',
  amber:  'bg-amber-50  text-amber-700  border-amber-200',
  red:    'bg-red-50    text-red-700    border-red-200',
  yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
}

interface Props {
  variant: 'orange' | 'blue' | 'green' | 'gray' | 'purple' | 'amber' | 'red' | 'yellow'
  children: React.ReactNode
  className?: string
}

export function StatusBadge({ variant, children, className = '' }: Props) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${VARIANT_STYLES[variant]} ${className}`}>
      {children}
    </span>
  )
}
