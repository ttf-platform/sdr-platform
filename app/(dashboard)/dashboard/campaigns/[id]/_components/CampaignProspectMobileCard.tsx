'use client'

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

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual', paste: 'Paste', csv_import: 'CSV', ai_discover: 'AI',
}

type Props = {
  prospect: TabProspect
  isSelected: boolean
  onToggleSelect: (e: React.MouseEvent) => void
  onClick: () => void
}

export function CampaignProspectMobileCard({ prospect: p, isSelected, onToggleSelect, onClick }: Props) {
  const name = [p.contacts?.first_name, p.contacts?.last_name].filter(Boolean).join(' ')
  const sigCount = Array.isArray(p.prospect_signals) ? (p.prospect_signals[0]?.count ?? 0) : 0

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
            {p.status}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-xs text-[#a89a86]">Added {fmtDate(p.added_at)}</span>
          {p.source && (
            <span className="text-xs text-[#6b5e4e] bg-[#f0ece6] px-2 py-0.5 rounded-full">
              {SOURCE_LABEL[p.source] ?? p.source}
            </span>
          )}
          {sigCount > 0 && (
            <span className="bg-blue-50 text-blue-600 border border-blue-200 rounded-full px-2 py-0.5 text-xs font-medium">
              📡 {sigCount} signal{sigCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
