'use client'
import { useState, useEffect, useRef } from 'react'

export type ExportFilters = {
  campaign_id?: string
  status?: string
  source?: string
  tag_ids?: string[]
  search?: string
}

type Props = {
  isOpen: boolean
  onClose: () => void
  selectedIds: string[]
  totalCount: number
  filteredCount: number
  filters: ExportFilters
}

const ALL_COLUMNS = [
  { key: 'email',        label: 'Email' },
  { key: 'first_name',   label: 'First name' },
  { key: 'last_name',    label: 'Last name' },
  { key: 'company',      label: 'Company' },
  { key: 'title',        label: 'Job title' },
  { key: 'linkedin_url', label: 'LinkedIn URL' },
  { key: 'website',      label: 'Website' },
  { key: 'status',       label: 'Status' },
  { key: 'source',       label: 'Source' },
  { key: 'tags',         label: 'Tags' },
  { key: 'notes',        label: 'Notes' },
  { key: 'added_at',     label: 'Date added' },
]

const DEFAULT_COLS = new Set(['email', 'first_name', 'last_name', 'company', 'title', 'status', 'tags', 'added_at'])

export function ExportProspectsModal({ isOpen, onClose, selectedIds, totalCount, filteredCount, filters }: Props) {
  const [format, setFormat]             = useState<'csv' | 'xlsx'>('csv')
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set(DEFAULT_COLS))
  const [scope, setScope]               = useState<'all' | 'filtered' | 'selected'>(
    selectedIds.length > 0 ? 'selected' : filteredCount < totalCount ? 'filtered' : 'all',
  )
  const [exporting, setExporting] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const dialogRef       = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Reset scope to smart default whenever modal opens
  useEffect(() => {
    if (!isOpen) return
    setScope(selectedIds.length > 0 ? 'selected' : filteredCount < totalCount ? 'filtered' : 'all')
    setError(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // P2: sync scope when selection is cleared externally
  useEffect(() => {
    if (selectedIds.length === 0 && scope === 'selected') {
      setScope(filteredCount < totalCount ? 'filtered' : 'all')
    }
  }, [selectedIds.length, scope, filteredCount, totalCount])

  // P0: focus trap + Escape handler + restore focus on close
  useEffect(() => {
    if (!isOpen) return

    previousFocusRef.current = document.activeElement as HTMLElement

    const focusableSelectors = [
      'button:not([disabled])',
      'input',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ')

    const dialog = dialogRef.current
    if (!dialog) return

    const focusables = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelectors))

    const first = focusables()[0]
    first?.focus()

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return

      const items = focusables()
      if (items.length === 0) return

      const last = items[items.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === items[0]) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); items[0].focus() }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  function toggleCol(key: string) {
    setSelectedCols(prev => {
      const n = new Set(prev)
      if (n.has(key)) { n.delete(key) } else { n.add(key) }
      return n
    })
  }

  const exportCount = scope === 'selected' ? selectedIds.length : scope === 'filtered' ? filteredCount : totalCount

  async function handleExport() {
    setExporting(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        format,
        columns: [...selectedCols].join(','),
      })

      if (scope === 'selected') {
        params.set('selected_ids', selectedIds.join(','))
      } else if (scope === 'filtered') {
        if (filters.campaign_id) params.set('campaign_id', filters.campaign_id)
        if (filters.status)      params.set('status', filters.status)
        if (filters.source)      params.set('source', filters.source)
        if (filters.search)      params.set('search', filters.search)
        if (filters.tag_ids?.length) params.set('tag_ids', filters.tag_ids.join(','))
      }

      const res = await fetch(`/api/prospects/export?${params}`)

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error ?? `Export failed (${res.status})`)
        return
      }

      const blob = await res.blob()
      const url  = window.URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+?)"/)?.[1]
        ?? `mirvo-prospects.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      onClose()
    } finally {
      setExporting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      {/* P1: role, aria-modal, aria-labelledby; P1: max-h + overflow-y-auto */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
        className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col gap-5 p-4 sm:p-6 max-h-[calc(100vh-2rem)] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 id="export-modal-title" className="text-base font-bold text-[#1a1a2e]">Export prospects</h2>
          {/* P1: aria-label on close button */}
          <button
            onClick={onClose}
            aria-label="Close export dialog"
            className="p-2 text-[#8a7e6e] hover:text-[#1a1a2e] text-xl leading-none"
          >
            ×
          </button>
        </div>

        {error && (
          <div role="alert" className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>
        )}

        {/* Format — P2: radiogroup role on wrapper */}
        <div>
          <p id="format-label" className="text-xs font-semibold text-[#6b5e4e] mb-2 uppercase tracking-wide">Format</p>
          <div role="radiogroup" aria-labelledby="format-label" className="flex gap-2">
            {(['csv', 'xlsx'] as const).map(f => (
              <button
                key={f}
                role="radio"
                aria-checked={format === f}
                onClick={() => setFormat(f)}
                className={`flex-1 py-2 rounded-lg text-sm border font-medium transition-colors ${format === f ? 'bg-[#1a1a2e] text-white border-[#1a1a2e]' : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#1a1a2e]'}`}
              >
                {f === 'csv' ? 'CSV' : 'Excel (XLSX)'}
              </button>
            ))}
          </div>
        </div>

        {/* Scope — P2: fieldset + sr-only legend */}
        <fieldset>
          <legend className="sr-only">What to export</legend>
          <p aria-hidden="true" className="text-xs font-semibold text-[#6b5e4e] mb-2 uppercase tracking-wide">What to export</p>
          <div className="flex flex-col gap-1.5">
            {selectedIds.length > 0 && (
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="radio" name="scope" checked={scope === 'selected'} onChange={() => setScope('selected')} className="accent-[#3b6bef]" />
                <span className="text-sm text-[#1a1a2e]">Selected rows <span className="text-[#8a7e6e]">({selectedIds.length})</span></span>
              </label>
            )}
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="radio" name="scope" checked={scope === 'filtered'} onChange={() => setScope('filtered')} className="accent-[#3b6bef]" />
              <span className="text-sm text-[#1a1a2e]">Filtered view <span className="text-[#8a7e6e]">({filteredCount.toLocaleString()} prospects)</span></span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} className="accent-[#3b6bef]" />
              <span className="text-sm text-[#1a1a2e]">All prospects <span className="text-[#8a7e6e]">({totalCount.toLocaleString()} total)</span></span>
            </label>
          </div>
        </fieldset>

        {/* Columns — P2: fieldset + sr-only legend */}
        <fieldset>
          <legend className="sr-only">Columns to include</legend>
          <p aria-hidden="true" className="text-xs font-semibold text-[#6b5e4e] mb-2 uppercase tracking-wide">Columns</p>
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_COLUMNS.map(col => (
              <label key={col.key} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={selectedCols.has(col.key)} onChange={() => toggleCol(col.key)} className="accent-[#3b6bef] w-3.5 h-3.5" />
                <span className="text-sm text-[#1a1a2e]">{col.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Footer */}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2.5 text-sm hover:border-[#1a1a2e] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || selectedCols.size === 0}
            className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 hover:bg-[#2a2a3e] transition-colors"
          >
            {exporting ? 'Exporting…' : `Export ${exportCount > 0 ? exportCount.toLocaleString() + ' ' : ''}prospects`}
          </button>
        </div>
      </div>
    </div>
  )
}
