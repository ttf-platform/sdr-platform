'use client'

interface ProgressBarProps {
  progress: number
  color?: string
  height?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
}

export function ProgressBar({ 
  progress, 
  color = 'bg-[var(--primary)]',
  height = 'md',
  showLabel = false,
  className = ''
}: ProgressBarProps) {
  const heightClasses = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-3'
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {showLabel && (
        <div className="flex justify-between text-sm">
          <span className="text-[var(--muted)]">Progression</span>
          <span className="font-medium text-[var(--foreground)]">{progress}%</span>
        </div>
      )}
      <div className={`progress-bar ${heightClasses[height]}`}>
        <div 
          className={`progress-fill ${color}`}
          style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
        />
      </div>
    </div>
  )
}