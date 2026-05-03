'use client'
import { useState, useRef, useEffect } from 'react'
import { getTagColorClasses } from '@/lib/tag-colors'

interface ProspectTag { id: string; label: string; color: string }

interface Props {
  availableTags:   ProspectTag[]
  selectedTagIds:  string[]
  onChange:        (ids: string[]) => void
}

export function TagFilterDropdown({ availableTags, selectedTagIds, onChange }: Props) {
  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const q        = search.toLowerCase()
  const filtered = availableTags.filter(t => !q || t.label.toLowerCase().includes(q))
  const count    = selectedTagIds.length

  function toggle(id: string) {
    onChange(selectedTagIds.includes(id)
      ? selectedTagIds.filter(x => x !== id)
      : [...selectedTagIds, id])
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`text-xs px-3 py-1.5 rounded-lg border capitalize transition-colors flex items-center gap-1 ${
          count > 0
            ? 'bg-[#3b6bef] text-white border-[#3b6bef]'
            : 'border-[#e8e3dc] text-[#6b5e4e] hover:bg-[#f5f2ee]'
        }`}
      >
        Tags
        {count > 0 && (
          <span className="text-[10px] text-white/80">· {count}</span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-[#e8e3dc] rounded-xl shadow-lg w-52">
          {availableTags.length > 5 && (
            <div className="p-2 border-b border-[#f0ece6]">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search tags…"
                className="w-full text-xs px-2 py-1.5 border border-[#e8e3dc] rounded-lg focus:outline-none focus:border-[#3b6bef]"
              />
            </div>
          )}

          <div className="py-1 max-h-48 overflow-y-auto">
            {availableTags.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <p className="text-xs text-[#6b5e4e]">No tags yet.</p>
                <p className="text-xs text-[#b0a898] mt-1">Create tags from a prospect&apos;s side panel.</p>
              </div>
            ) : filtered.map(tag => {
              const cls     = getTagColorClasses(tag.color)
              const checked = selectedTagIds.includes(tag.id)
              return (
                <label key={tag.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#f5f2ee] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(tag.id)}
                    className="rounded border-[#e8e3dc] text-[#3b6bef]"
                  />
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cls.dot}`} />
                  <span className="text-xs text-[#1a1a2e] truncate">{tag.label}</span>
                </label>
              )
            })}
          </div>

          {count > 0 && (
            <div className="border-t border-[#f0ece6] p-2">
              <button
                onClick={() => { onChange([]); setOpen(false) }}
                className="w-full text-xs text-[#8a7e6e] hover:text-[#1a1a2e] text-center py-1"
              >
                Clear filter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
