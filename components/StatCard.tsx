import React from 'react'
import { LucideIcon } from 'lucide-react'
import clsx from 'clsx'

interface StatCardProps {
  title: string
  value: string | number
  change?: {
    value: string
    type: 'increase' | 'decrease' | 'neutral'
  }
  icon: LucideIcon
  color?: 'primary' | 'success' | 'warning' | 'info'
}

const colorClasses = {
  primary: 'bg-primary text-white',
  success: 'bg-green-500 text-white',
  warning: 'bg-yellow-500 text-white',
  info: 'bg-blue-500 text-white',
}

const changeColorClasses = {
  increase: 'text-green-600 bg-green-50',
  decrease: 'text-red-600 bg-red-50',
  neutral: 'text-gray-600 bg-gray-50',
}

export default function StatCard({ 
  title, 
  value, 
  change, 
  icon: Icon, 
  color = 'primary' 
}: StatCardProps) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow duration-200">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          
          {change && (
            <div className={clsx(
              'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium mt-3',
              changeColorClasses[change.type]
            )}>
              {change.type === 'increase' && '↗'}
              {change.type === 'decrease' && '↘'}
              {change.type === 'neutral' && '→'}
              <span className="ml-1">{change.value}</span>
            </div>
          )}
        </div>
        
        <div className={clsx(
          'w-12 h-12 rounded-lg flex items-center justify-center',
          colorClasses[color]
        )}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  )
}