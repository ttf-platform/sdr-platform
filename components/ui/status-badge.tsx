'use client'

interface StatusBadgeProps {
  status: 'active' | 'paused' | 'draft' | 'completed' | 'error'
  children: React.ReactNode
  className?: string
}

export function StatusBadge({ status, children, className = '' }: StatusBadgeProps) {
  const statusStyles = {
    active: 'bg-green-50 text-green-700 border-green-200',
    paused: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    draft: 'bg-gray-50 text-gray-700 border-gray-200',
    completed: 'bg-blue-50 text-blue-700 border-blue-200',
    error: 'bg-red-50 text-red-700 border-red-200'
  }

  return (
    <span className={`
      inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border
      ${statusStyles[status]} ${className}
    `}>
      {children}
    </span>
  )
}