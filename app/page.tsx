import React from 'react'
import Sidebar from '@/components/Sidebar'
import StatCard from '@/components/StatCard'
import MetricsChart from '@/components/MetricsChart'
import RecentActivity from '@/components/RecentActivity'
import { 
  Mail, 
  Users, 
  MessageCircle, 
  TrendingUp,
  Target,
  Calendar,
  Clock,
  Zap
} from 'lucide-react'

// Mock data pour les métriques
const chartData = [
  { date: 'Jan 1', sent: 120, opened: 45, replied: 12 },
  { date: 'Jan 2', sent: 135, opened: 52, replied: 15 },
  { date: 'Jan 3', sent: 98, opened: 38, replied: 8 },
  { date: 'Jan 4', sent: 167, opened: 67, replied: 22 },
  { date: 'Jan 5', sent: 142, opened: 58, replied: 18 },
  { date: 'Jan 6', sent: 156, opened: 62, replied: 19 },
  { date: 'Jan 7', sent: 189, opened: 78, replied: 28 },
]

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      
      {/* Main content */}
      <div className="ml-64 flex-1">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
              <p className="text-gray-600 mt-1">
                Welcome back, Max. Here's what's happening with your campaigns.
              </p>
            </div>
            
            <div className="flex items-center space-x-3">
              <button className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors duration-200 flex items-center space-x-2">
                <Calendar className="w-4 h-4" />
                <span>Last 7 days</span>
              </button>
              
              <button className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors duration-200 flex items-center space-x-2">
                <Target className="w-4 h-4" />
                <span>New Campaign</span>
              </button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="p-8 space-y-8">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard
              title="Total Emails Sent"
              value="1,247"
              change={{ value: "+12%", type: "increase" }}
              icon={Mail}
              color="primary"
            />
            
            <StatCard
              title="Active Leads"
              value="342"
              change={{ value: "+8%", type: "increase" }}
              icon={Users}
              color="info"
            />
            
            <StatCard
              title="Reply Rate"
              value="18.4%"
              change={{ value: "+2.1%", type: "increase" }}
              icon={MessageCircle}
              color="success"
            />
            
            <StatCard
              title="Conversion Rate"
              value="4.2%"
              change={{ value: "-0.3%", type: "decrease" }}
              icon={TrendingUp}
              color="warning"
            />
          </div>

          {/* Charts and Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="lg:col-span-1">
              <MetricsChart 
                data={chartData}
                title="Email Performance (Last 7 days)"
              />
            </div>
            
            <div className="lg:col-span-1">
              <RecentActivity />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">Quick Actions</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <button className="bg-primary text-white p-4 rounded-lg hover:bg-primary-dark transition-colors duration-200 flex flex-col items-center space-y-2">
                <Target className="w-6 h-6" />
                <span className="font-medium">New Campaign</span>
                <span className="text-xs opacity-90">Create targeted outreach</span>
              </button>
              
              <button className="bg-gray-100 text-gray-700 p-4 rounded-lg hover:bg-gray-200 transition-colors duration-200 flex flex-col items-center space-y-2">
                <Users className="w-6 h-6" />
                <span className="font-medium">Import Leads</span>
                <span className="text-xs opacity-75">Add new prospects</span>
              </button>
              
              <button className="bg-gray-100 text-gray-700 p-4 rounded-lg hover:bg-gray-200 transition-colors duration-200 flex flex-col items-center space-y-2">
                <Mail className="w-6 h-6" />
                <span className="font-medium">Email Sequences</span>
                <span className="text-xs opacity-75">Manage templates</span>
              </button>
              
              <button className="bg-gray-100 text-gray-700 p-4 rounded-lg hover:bg-gray-200 transition-colors duration-200 flex flex-col items-center space-y-2">
                <Zap className="w-6 h-6" />
                <span className="font-medium">Integrations</span>
                <span className="text-xs opacity-75">Connect tools</span>
              </button>
            </div>
          </div>

          {/* Performance Summary */}
          <div className="bg-gradient-to-r from-primary to-primary-light rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold mb-2">Today's Performance</h3>
                <div className="flex items-center space-x-6">
                  <div className="flex items-center space-x-2">
                    <Clock className="w-5 h-5" />
                    <div>
                      <p className="text-sm opacity-90">Active Time</p>
                      <p className="font-semibold">8h 42m</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Mail className="w-5 h-5" />
                    <div>
                      <p className="text-sm opacity-90">Emails Sent</p>
                      <p className="font-semibold">89</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <MessageCircle className="w-5 h-5" />
                    <div>
                      <p className="text-sm opacity-90">Replies</p>
                      <p className="font-semibold">12</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="text-right">
                <p className="text-2xl font-bold">94%</p>
                <p className="text-sm opacity-90">Uptime</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}