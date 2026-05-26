import { ReactNode } from 'react'

type EmptyStateProps = {
  icon?: string
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon = '📭', title, description, action }: EmptyStateProps) {
  return (
    <div className="border border-[#e8e3dc] rounded-2xl p-12 text-center bg-white">
      <p className="text-5xl mb-4">{icon}</p>
      <h3 className="text-base font-semibold text-[#1a1a2e] mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-[#8a7e6e] mb-6 max-w-md mx-auto">{description}</p>
      )}
      {action && <div>{action}</div>}
    </div>
  )
}
