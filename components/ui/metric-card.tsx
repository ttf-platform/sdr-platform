'use client'

import { LucideIcon } from 'lucide-react'
import { ArrowUp, ArrowDown } from 'lucide-react'

interface MetricCardProps {
  title: string
  value: string | number
  change?: string
  trend?: 'up' | 'down' | 'neutral'
  icon: LucideIcon
  color?: string
  className?: string
}

export function MetricCard({ 
  title, 
  value, 
  change, 
  trend = 'neutral',
  icon: Icon,
  color = 'text-gray-600',
  className = ''
}: MetricCardProps) {
  const trendColors = {
    up: 'text-green-600',
    down: 'text-red-600',
    neutral: 'text-gray-600'
  }

  return (
    <div className={`metric-card animate-slide-in ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className={`p-3 rounded-xl bg-gray-50 ${color}`}>
          <Icon size={24} strokeWidth={1.5} />
        </div>
        {change && (
          <div className={`flex items-center gap-1 text-sm font-medium ${trendColors[trend]}`}>
            {trend === 'up' && <ArrowUp size={16} strokeWidth={2} />}
            {trend === 'down' && <ArrowDown size={16} strokeWidth={2} />}
            {change}
          </div>
        )}
      </div>
      <div>
        <p className="text-3xl font-semibold text-[var(--foreground)] mb-1">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        <p className="text-sm text-[var(--muted)] font-medium">{title}</p>
      </div>
    </div>
  )
}