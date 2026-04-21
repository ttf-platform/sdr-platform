'use client'

import { PlayCircle, PauseCircle, MoreVertical, Users, Mail, Calendar } from 'lucide-react'
import { StatusBadge } from '../ui/status-badge'
import { ProgressBar } from '../ui/progress-bar'

interface Campaign {
  id: string
  name: string
  status: 'active' | 'paused' | 'draft' | 'completed'
  leads: number
  sent: number
  replies: number
  meetings: number
  responseRate: number
  progress: number
}

interface CampaignCardProps {
  campaign: Campaign
  onToggleStatus?: (campaignId: string) => void
  onViewDetails?: (campaignId: string) => void
}

export function CampaignCard({ campaign, onToggleStatus, onViewDetails }: CampaignCardProps) {
  const handleToggleStatus = () => {
    onToggleStatus?.(campaign.id)
  }

  const handleViewDetails = () => {
    onViewDetails?.(campaign.id)
  }

  return (
    <div className="card p-6 hover:shadow-md transition-all duration-200 animate-slide-in">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <button 
              onClick={handleToggleStatus}
              className="text-[var(--muted)] hover:text-[var(--primary)] transition-colors"
            >
              {campaign.status === 'active' ? (
                <PlayCircle className="text-green-600" size={20} />
              ) : (
                <PauseCircle className="text-yellow-600" size={20} />
              )}
            </button>
            <h3 className="font-semibold text-[var(--foreground)] text-lg">{campaign.name}</h3>
          </div>
          <StatusBadge status={campaign.status}>
            {campaign.status === 'active' ? 'En cours' : 
             campaign.status === 'paused' ? 'En pause' :
             campaign.status === 'draft' ? 'Brouillon' : 'Terminée'}
          </StatusBadge>
        </div>
        
        <button 
          onClick={handleViewDetails}
          className="text-[var(--muted)] hover:text-[var(--foreground)] p-1 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <MoreVertical size={16} />
        </button>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="text-center p-3 rounded-lg bg-gray-50">
          <div className="flex items-center justify-center mb-2">
            <Users size={16} className="text-blue-600" />
          </div>
          <p className="text-lg font-semibold text-[var(--foreground)]">{campaign.leads.toLocaleString()}</p>
          <p className="text-xs text-[var(--muted)]">Leads</p>
        </div>
        
        <div className="text-center p-3 rounded-lg bg-gray-50">
          <div className="flex items-center justify-center mb-2">
            <Mail size={16} className="text-purple-600" />
          </div>
          <p className="text-lg font-semibold text-[var(--foreground)]">{campaign.sent.toLocaleString()}</p>
          <p className="text-xs text-[var(--muted)]">Envoyés</p>
        </div>
        
        <div className="text-center p-3 rounded-lg bg-gray-50">
          <div className="flex items-center justify-center mb-2">
            <Mail size={16} className="text-green-600" />
          </div>
          <p className="text-lg font-semibold text-[var(--foreground)]">{campaign.replies}</p>
          <p className="text-xs text-[var(--muted)]">Réponses</p>
        </div>
        
        <div className="text-center p-3 rounded-lg bg-gray-50">
          <div className="flex items-center justify-center mb-2">
            <Calendar size={16} className="text-emerald-600" />
          </div>
          <p className="text-lg font-semibold text-[var(--foreground)]">{campaign.meetings}</p>
          <p className="text-xs text-[var(--muted)]">Meetings</p>
        </div>
      </div>

      {/* Response Rate */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-[var(--muted)]">Taux de réponse</span>
          <span className="text-sm font-medium text-[var(--foreground)]">{campaign.responseRate}%</span>
        </div>
        <ProgressBar 
          progress={campaign.responseRate} 
          color="bg-green-500"
          height="sm"
        />
      </div>

      {/* Campaign Progress */}
      <ProgressBar 
        progress={campaign.progress}
        showLabel={true}
      />
    </div>
  )
}