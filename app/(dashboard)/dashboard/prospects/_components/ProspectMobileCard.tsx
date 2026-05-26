'use client'

import { Tag } from '@/components/Tag'

type ProspectTag = { id: string; label: string; color: string }

export type ProspectCardData = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  company: string | null
  title: string | null
  campaigns_count: number
  primary_campaign_name: string | null
  primary_source: string | null
  added_at: string
  tags: ProspectTag[]
}

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual', paste: 'Paste', csv_import: 'CSV',
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

type Props = {
  contact: ProspectCardData
  isSelected: boolean
  onToggleSelect: (e: React.MouseEvent) => void
  onClick: () => void
}

export function ProspectMobileCard({ contact: c, isSelected, onToggleSelect, onClick }: Props) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ')

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
        <p className="text-sm font-medium text-[#1a1a2e] truncate">
          {name || <span className="text-[#b0a898] font-normal">—</span>}
        </p>
        {c.title && <p className="text-xs text-[#8a7e6e] truncate">{c.title}</p>}
        <p className="text-xs text-[#6b5e4e] truncate mt-0.5">{c.email}</p>
        {c.company && <p className="text-xs text-[#8a7e6e] truncate mt-0.5">{c.company}</p>}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {c.campaigns_count > 0 && (
            c.campaigns_count === 1 ? (
              <span className="text-xs text-[#3b6bef] font-medium bg-[#eef1fd] px-2 py-0.5 rounded-full max-w-[140px] truncate inline-block">
                {c.primary_campaign_name ?? '1 campaign'}
              </span>
            ) : (
              <span className="text-xs text-[#3b6bef] font-medium bg-[#eef1fd] px-2 py-0.5 rounded-full">
                {c.campaigns_count} campaigns
              </span>
            )
          )}
          {c.primary_source && (
            <span className="text-xs text-[#6b5e4e] bg-[#f0ece6] px-2 py-0.5 rounded-full">
              {SOURCE_LABEL[c.primary_source] ?? c.primary_source}
            </span>
          )}
          {c.tags.slice(0, 2).map(t => (
            <Tag key={t.id} label={t.label} color={t.color} />
          ))}
          {c.tags.length > 2 && (
            <span className="text-[10px] text-[#8a7e6e] self-center">+{c.tags.length - 2}</span>
          )}
        </div>
        <p className="text-xs text-[#a89a86] mt-2">Added {fmtDate(c.added_at)}</p>
      </div>
    </div>
  )
}
