'use client'

import { useState } from 'react'
import { 
  BarChart3, 
  Users, 
  Mail, 
  Calendar,
  DollarSign,
  TrendingUp,
  PlayCircle,
  PauseCircle,
  Eye,
  Send,
  UserCheck,
  Clock,
  ArrowUp,
  ArrowDown,
  MoreVertical
} from 'lucide-react'

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('dashboard')

  const metrics = [
    {
      title: 'Leads Contactés',
      value: '2,847',
      change: '+12%',
      trend: 'up',
      icon: Users,
      color: 'text-blue-600'
    },
    {
      title: 'Taux de Réponse',
      value: '23.4%',
      change: '+3.2%',
      trend: 'up',
      icon: Mail,
      color: 'text-green-600'
    },
    {
      title: 'Meetings Bookés',
      value: '89',
      change: '+18%',
      trend: 'up',
      icon: Calendar,
      color: 'text-purple-600'
    },
    {
      title: 'Revenue Pipeline',
      value: '$284K',
      change: '+25%',
      trend: 'up',
      icon: DollarSign,
      color: 'text-emerald-600'
    }
  ]

  const campaigns = [
    {
      name: 'SaaS Founders - Series A',
      status: 'active',
      leads: 1247,
      sent: 892,
      replies: 94,
      meetings: 23,
      progress: 71
    },
    {
      name: 'E-commerce Directors',
      status: 'active',
      leads: 834,
      sent: 612,
      replies: 67,
      meetings: 18,
      progress: 73
    },
    {
      name: 'Marketing Heads - Tech',
      status: 'paused',
      leads: 956,
      sent: 234,
      replies: 12,
      meetings: 4,
      progress: 25
    },
    {
      name: 'Product Managers - B2B',
      status: 'active',
      leads: 623,
      sent: 623,
      replies: 78,
      meetings: 15,
      progress: 100
    }
  ]

  const activities = [
    {
      type: 'reply',
      message: 'Sarah Chen replied to SaaS Founders campaign',
      time: '2 min ago',
      priority: 'high'
    },
    {
      type: 'meeting',
      message: 'Meeting booked with Mike Rodriguez',
      time: '15 min ago',
      priority: 'high'
    },
    {
      type: 'sent',
      message: '47 emails sent in E-commerce Directors campaign',
      time: '1 hour ago',
      priority: 'normal'
    },
    {
      type: 'lead',
      message: '12 new leads added to Marketing Heads campaign',
      time: '2 hours ago',
      priority: 'normal'
    },
    {
      type: 'bounce',
      message: '3 emails bounced in Product Managers campaign',
      time: '3 hours ago',
      priority: 'low'
    }
  ]

  const sidebarItems = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'campaigns', label: 'Campagnes', icon: Send },
    { id: 'leads', label: 'Leads', icon: Users },
    { id: 'analytics', label: 'Analytics', icon: TrendingUp },
    { id: 'sequences', label: 'Séquences', icon: Mail },
    { id: 'calendar', label: 'Calendrier', icon: Calendar },
  ]

  return (
    <div className="flex h-screen bg-[var(--background)]">
      {/* Sidebar */}
      <div className="w-64 bg-[var(--card)] border-r border-[var(--border)]">
        <div className="p-6">
          <h1 className="text-xl font-semibold text-[var(--primary)]">SDR Platform</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Autonomous Outreach</p>
        </div>
        
        <nav className="px-4">
          {sidebarItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === item.id 
                    ? 'bg-[var(--primary)] text-white' 
                    : 'text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-gray-50'
                }`}
              >
                <Icon size={18} />
                {item.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          {/* Header */}
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-[var(--foreground)] mb-2">Dashboard</h2>
            <p className="text-[var(--muted)]">Vue d'ensemble de vos campagnes de cold outreach</p>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {metrics.map((metric, index) => {
              const Icon = metric.icon
              return (
                <div key={index} className="bg-[var(--card)] rounded-xl p-6 border border-[var(--border)]">
                  <div className="flex items-center justify-between mb-4">
                    <div className={`p-2 rounded-lg bg-gray-50 ${metric.color}`}>
                      <Icon size={20} />
                    </div>
                    <div className={`flex items-center gap-1 text-sm ${
                      metric.trend === 'up' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {metric.trend === 'up' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                      {metric.change}
                    </div>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold text-[var(--foreground)] mb-1">{metric.value}</p>
                    <p className="text-sm text-[var(--muted)]">{metric.title}</p>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Active Campaigns */}
            <div className="bg-[var(--card)] rounded-xl border border-[var(--border)]">
              <div className="p-6 border-b border-[var(--border)]">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-[var(--foreground)]">Campagnes Actives</h3>
                  <button className="text-[var(--primary)] text-sm font-medium hover:underline">
                    Voir tout
                  </button>
                </div>
              </div>
              <div className="p-6 space-y-4">
                {campaigns.map((campaign, index) => (
                  <div key={index} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {campaign.status === 'active' ? (
                          <PlayCircle className="text-green-600" size={16} />
                        ) : (
                          <PauseCircle className="text-yellow-600" size={16} />
                        )}
                        <span className="font-medium text-[var(--foreground)]">{campaign.name}</span>
                      </div>
                      <button className="text-[var(--muted)] hover:text-[var(--foreground)]">
                        <MoreVertical size={16} />
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-[var(--muted)]">Leads</p>
                        <p className="font-medium">{campaign.leads.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[var(--muted)]">Envoyés</p>
                        <p className="font-medium">{campaign.sent.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[var(--muted)]">Réponses</p>
                        <p className="font-medium">{campaign.replies}</p>
                      </div>
                      <div>
                        <p className="text-[var(--muted)]">Meetings</p>
                        <p className="font-medium">{campaign.meetings}</p>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-[var(--muted)]">Progression</span>
                        <span className="font-medium">{campaign.progress}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-[var(--primary)] h-2 rounded-full transition-all"
                          style={{ width: `${campaign.progress}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Activity Feed */}
            <div className="bg-[var(--card)] rounded-xl border border-[var(--border)]">
              <div className="p-6 border-b border-[var(--border)]">
                <h3 className="text-lg font-semibold text-[var(--foreground)]">Activité Récente</h3>
              </div>
              <div className="p-6 space-y-4">
                {activities.map((activity, index) => {
                  const getActivityIcon = (type: string) => {
                    switch (type) {
                      case 'reply': return <Mail className="text-blue-600" size={16} />
                      case 'meeting': return <Calendar className="text-green-600" size={16} />
                      case 'sent': return <Send className="text-purple-600" size={16} />
                      case 'lead': return <UserCheck className="text-emerald-600" size={16} />
                      case 'bounce': return <ArrowDown className="text-red-600" size={16} />
                      default: return <Clock className="text-gray-600" size={16} />
                    }
                  }

                  return (
                    <div key={index} className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {getActivityIcon(activity.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--foreground)]">{activity.message}</p>
                        <p className="text-xs text-[var(--muted)] mt-1 flex items-center gap-1">
                          <Clock size={12} />
                          {activity.time}
                        </p>
                      </div>
                      <div className={`w-2 h-2 rounded-full ${
                        activity.priority === 'high' ? 'bg-red-500' :
                        activity.priority === 'normal' ? 'bg-yellow-500' : 'bg-gray-400'
                      }`}></div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}