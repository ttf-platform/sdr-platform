import React from 'react'
import { Mail, UserPlus, MessageCircle, Target } from 'lucide-react'
import clsx from 'clsx'

interface ActivityItem {
  id: string
  type: 'email_sent' | 'lead_added' | 'reply_received' | 'campaign_started'
  title: string
  description: string
  time: string
  status?: 'success' | 'pending' | 'error'
}

const mockActivities: ActivityItem[] = [
  {
    id: '1',
    type: 'reply_received',
    title: 'Reply received from John Smith',
    description: 'Interested in our solution - wants to schedule a demo',
    time: '2 min ago',
    status: 'success'
  },
  {
    id: '2',
    type: 'email_sent',
    title: 'Follow-up sequence #2 sent',
    description: '45 emails sent to "Q4 Enterprise Leads" campaign',
    time: '15 min ago',
    status: 'success'
  },
  {
    id: '3',
    type: 'lead_added',
    title: 'New leads imported',
    description: '127 new leads added from Apollo.io integration',
    time: '1 hour ago',
    status: 'success'
  },
  {
    id: '4',
    type: 'campaign_started',
    title: 'New campaign launched',
    description: '"SaaS Decision Makers" campaign is now active',
    time: '2 hours ago',
    status: 'success'
  },
  {
    id: '5',
    type: 'email_sent',
    title: 'Warm-up emails sent',
    description: '12 warm-up emails to improve sender reputation',
    time: '3 hours ago',
    status: 'pending'
  }
]

const getIcon = (type: ActivityItem['type']) => {
  switch (type) {
    case 'email_sent': return Mail
    case 'lead_added': return UserPlus
    case 'reply_received': return MessageCircle
    case 'campaign_started': return Target
    default: return Mail
  }
}

const getIconColor = (status?: ActivityItem['status']) => {
  switch (status) {
    case 'success': return 'bg-green-100 text-green-600'
    case 'pending': return 'bg-yellow-100 text-yellow-600'
    case 'error': return 'bg-red-100 text-red-600'
    default: return 'bg-gray-100 text-gray-600'
  }
}

export default function RecentActivity() {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Recent Activity</h3>
        <button className="text-sm text-primary hover:text-primary-dark font-medium">
          View all
        </button>
      </div>

      <div className="space-y-4">
        {mockActivities.map((activity, index) => {
          const Icon = getIcon(activity.type)
          
          return (
            <div key={activity.id} className="flex items-start space-x-3 animate-slide-up" 
                 style={{ animationDelay: `${index * 0.1}s` }}>
              <div className={clsx(
                'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                getIconColor(activity.status)
              )}>
                <Icon className="w-4 h-4" />
              </div>
              
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {activity.title}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  {activity.description}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {activity.time}
                </p>
              </div>

              {activity.status === 'success' && (
                <div className="flex-shrink-0">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-6 pt-4 border-t border-gray-100">
        <button className="w-full text-center text-sm text-gray-500 hover:text-gray-700 font-medium">
          Load more activities
        </button>
      </div>
    </div>
  )
}