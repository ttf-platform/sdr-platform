'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  BarChart3, 
  Users, 
  Mail, 
  Target, 
  Settings, 
  Home,
  Zap,
  Database,
  TrendingUp,
  MessageSquare
} from 'lucide-react'
import clsx from 'clsx'

const navigation = [
  { name: 'Dashboard', href: '/', icon: Home },
  { name: 'Campaigns', href: '/campaigns', icon: Target },
  { name: 'Leads', href: '/leads', icon: Users },
  { name: 'Sequences', href: '/sequences', icon: Mail },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Conversations', href: '/conversations', icon: MessageSquare },
  { name: 'Integrations', href: '/integrations', icon: Zap },
  { name: 'Database', href: '/database', icon: Database },
]

const secondaryNavigation = [
  { name: 'Settings', href: '/settings', icon: Settings },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex h-screen w-64 flex-col bg-white border-r border-gray-200 fixed left-0 top-0 z-30">
      {/* Logo */}
      <div className="flex h-16 items-center px-6 border-b border-gray-200">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-semibold text-gray-900">SDR Platform</span>
        </div>
      </div>

      {/* Navigation principale */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'group flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200',
                isActive
                  ? 'bg-primary text-white shadow-md'
                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <item.icon
                className={clsx(
                  'mr-3 h-5 w-5 transition-colors duration-200',
                  isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-500'
                )}
                aria-hidden="true"
              />
              {item.name}
            </Link>
          )
        })}
      </nav>

      {/* Navigation secondaire */}
      <div className="px-3 py-4 border-t border-gray-200">
        {secondaryNavigation.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'group flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200',
                isActive
                  ? 'bg-primary text-white shadow-md'
                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <item.icon
                className={clsx(
                  'mr-3 h-5 w-5 transition-colors duration-200',
                  isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-500'
                )}
                aria-hidden="true"
              />
              {item.name}
            </Link>
          )
        })}
      </div>

      {/* User info */}
      <div className="px-6 py-4 border-t border-gray-200">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-primary-light rounded-full flex items-center justify-center">
            <span className="text-white font-medium text-sm">MX</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">Max</p>
            <p className="text-xs text-gray-500">Admin</p>
          </div>
        </div>
      </div>
    </div>
  )
}