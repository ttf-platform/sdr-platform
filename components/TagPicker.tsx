'use client'
import { useState, useEffect, useRef } from 'react'
import { getTagColorClasses } from '@/lib/tag-colors'

interface ProspectTag { id: string; label: string; color: string }

interface Props {
  workspaceId:    string
  assignedTagIds: string[]
  onAssign:       (tag: ProspectTag) => void
  onCreate:       (label: string) => void
  onClose:        () => void
}

export function TagPicker({ assignedTagIds, onAssign, onCreate, onClose }: Props) {
  const [search, setSearch]         = useState('')
  const [allTags, setAllTags]       = useState<ProspectTag[]>([])
  const [loading, setLoading]       = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/tags')
      .then(r => r.json())
      .then(d => setAllTags(d.tags ?? []))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const q       = search.trim().toLowerCase()
  const filtered = allTags
    .filter(t => !assignedTagIds.includes(t.id))
    .filter(t => !q || t.label.toLowerCase().includes(q))

  const exactMatch = allTags.some(t => t.label.toLowerCase() === q)

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full mt-1 z-50 bg-white border border-[#e8e3dc] rounded-xl shadow-lg w-56"
    >
      <div className="p-2 border-b border-[#f0ece6]">
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search or create…"
          className="w-full text-xs px-2 py-1.5 border border-[#e8e3dc] rounded-lg focus:outline-none focus:border-[#3b6bef]"
        />
      </div>

      <div className="max-h-48 overflow-y-auto py-1">
        {loading ? (
          <div className="px-3 py-2 text-xs text-[#b0a898]">Loading…</div>
        ) : filtered.length === 0 && !q ? (
          <div className="px-3 py-2 text-xs text-[#b0a898]">No tags yet — type to create one.</div>
        ) : (
          filtered.map(tag => {
            const cls = getTagColorClasses(tag.color)
            return (
              <button
                key={tag.id}
                onClick={() => { onAssign(tag); onClose() }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[#f5f2ee] text-left"
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cls.dot}`} />
                <span className="text-[#1a1a2e] truncate">{tag.label}</span>
              </button>
            )
          })
        )}
      </div>

      {q && !exactMatch && (
        <div className="border-t border-[#f0ece6] p-2">
          <button
            onClick={() => { onCreate(search.trim()); onClose() }}
            className="w-full text-left text-xs px-2 py-1.5 text-[#3b6bef] hover:bg-[#eef1fd] rounded-lg"
          >
            + Create &ldquo;{search.trim()}&rdquo;
          </button>
        </div>
      )}
    </div>
  )
}
