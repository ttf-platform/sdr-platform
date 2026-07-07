'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { TAG_COLORS } from '@/lib/tag-colors'

const DOT_HEX: Record<string, string> = {
  gray:   '#9ca3af',
  blue:   '#3b82f6',
  green:  '#22c55e',
  purple: '#a855f7',
  orange: '#f97316',
  red:    '#ef4444',
  yellow: '#eab308',
  pink:   '#ec4899',
}

interface Props {
  initialLabel: string
  prospectId:   string
  onCreated:    (tag: { id: string; label: string; color: string }) => void
  onClose:      () => void
}

export function CreateTagModal({ initialLabel, prospectId, onCreated, onClose }: Props) {
  const t                     = useTranslations('components.createTagModal')
  const [label,   setLabel]   = useState(initialLabel)
  const [color,   setColor]   = useState('gray')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  async function handleCreate() {
    const trimmed = label.trim()
    if (!trimmed) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/tags', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ label: trimmed, color }),
      }).then(r => r.json())

      if (res.error) { setError(res.error); setSaving(false); return }

      // Assign to prospect
      await fetch(`/api/prospects/${prospectId}/tags`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tag_id: res.tag.id }),
      })

      onCreated(res.tag)
    } catch {
      setError(t('errorCreate'))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-4 sm:p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <h3 className="text-base font-bold text-[#1a1a2e] mb-4">{t('title')}</h3>

        <div className="mb-4">
          <label className="text-xs font-medium text-[#6b5e4e] block mb-1">{t('labelField')}</label>
          <input
            autoFocus
            value={label}
            onChange={e => setLabel(e.target.value.slice(0, 30))}
            maxLength={30}
            placeholder={t('labelPlaceholder')}
            className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
          />
          <p className="text-[10px] text-[#b0a898] mt-1 text-right">{label.length}/30</p>
        </div>

        <div className="mb-5">
          <label className="text-xs font-medium text-[#6b5e4e] block mb-2">{t('colorField')}</label>
          <div className="grid grid-cols-8 gap-2">
            {TAG_COLORS.map(c => (
              <button
                key={c.value}
                type="button"
                onClick={() => setColor(c.value)}
                style={{ backgroundColor: DOT_HEX[c.value] }}
                className={`w-8 h-8 rounded-full transition-all hover:scale-110 ${
                  color === c.value ? 'ring-2 ring-offset-2 ring-blue-500' : ''
                }`}
                aria-label={t('colorAriaLabel', { color: c.value })}
              />
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={saving}
            className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 p-2 text-sm disabled:opacity-40">
            {t('cancel')}
          </button>
          <button onClick={handleCreate} disabled={saving || !label.trim()}
            className="flex-1 bg-[#3b6bef] text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40">
            {saving ? t('creating') : t('create')}
          </button>
        </div>
      </div>
    </div>
  )
}
