'use client'

import { useTranslations } from 'next-intl'
import { statusBadgeClass } from '@/components/ProspectModals'

type TabProspect = {
  id: string
  email: string
  status: string
  source: string
  added_at: string
  contacts: { first_name: string | null; last_name: string | null; company: string | null; title: string | null } | null
  prospect_signals: [{ count: number }] | null
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Values only. Source labels resolved at render via useTranslations('...sources') → t(p.source).
// Reused set from Lot 2A.4.2 — dashboard.campaigns.detail.sources.*
const SOURCE_KEYS = ['manual', 'paste', 'csv_import', 'ai_discover'] as const
// Prospect status keys — reused from Lot 2A.3 dashboard.prospects.list.statuses.*
const PROSPECT_STATUS_KEYS = ['found', 'emailed', 'opened', 'replied', 'meeting', 'bounced', 'unsubscribed'] as const

type Props = {
  prospect: TabProspect
  isSelected: boolean
  onToggleSelect: (e: React.MouseEvent) => void
  onClick: () => void
}

export function CampaignProspectMobileCard({ prospect: p, isSelected, onToggleSelect, onClick }: Props) {
  const tSources = useTranslations('dashboard.campaigns.detail.sources')
  const tStatuses = useTranslations('dashboard.prospects.list.statuses')
  const tSidePanel = useTranslations('dashboard.prospects.list.sidePanel')
  const tSignals = useTranslations('dashboard.campaigns.detail.prospects')

  const name = [p.contacts?.first_name, p.contacts?.last_name].filter(Boolean).join(' ')
  const sigCount = Array.isArray(p.prospect_signals) ? (p.prospect_signals[0]?.count ?? 0) : 0

  const statusLabel = (PROSPECT_STATUS_KEYS as readonly string[]).includes(p.status)
    ? tStatuses(p.status)
    : p.status
  const sourceLabel = (SOURCE_KEYS as readonly string[]).includes(p.source)
    ? tSources(p.source)
    : p.source

  return (
    <div
      onClick={onClick}
      className={`border rounded-xl p-4 bg-white flex items-start gap-3 cursor-pointer transition-colors ${isSelected ? 'bg-[#f5f7ff] border-[#c8d4e8]' : 'border-[#e8e3dc] hover:bg-[#faf8f5]'}`}
    >
      <div onClick={onToggleSelect} className="mt-0.5 flex-shrink-0">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => {}}
          className="w-4 h-4 rounded border-[#e8e3dc] text-[#3b6bef] cursor-pointer"
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#1a1a2e] truncate">{name || '—'}</p>
            {p.contacts?.company && <p className="text-xs text-[#8a7e6e] truncate">{p.contacts.company}</p>}
            <p className="text-xs text-[#6b5e4e] truncate mt-0.5">{p.email}</p>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium flex-shrink-0 ${statusBadgeClass(p.status)}`}>
            {statusLabel}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-xs text-[#a89a86]">{tSidePanel('addedOn', { date: fmtDate(p.added_at) })}</span>
          {p.source && (
            <span className="text-xs text-[#6b5e4e] bg-[#f0ece6] px-2 py-0.5 rounded-full">
              {sourceLabel}
            </span>
          )}
          {sigCount > 0 && (
            <span className="bg-blue-50 text-blue-600 border border-blue-200 rounded-full px-2 py-0.5 text-xs font-medium">
              {tSignals('signalPill', { count: sigCount })}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
