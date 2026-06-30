'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { safeExternalHref } from '@/lib/url-safety'

type SignalDetail = {
  id: string
  signal_id: string
  signal_data: Record<string, unknown>
  source_url: string | null
  detected_at: string
  signals: {
    id: string
    name: string
    description: string | null
    source_type: 'template' | 'custom'
    template_id: string | null
  }
}

type ProspectSignalsDrawerProps = {
  open: boolean
  onClose: () => void
  prospectId: string
  prospectEmail: string
  prospectName?: string
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export function ProspectSignalsDrawer({
  open,
  onClose,
  prospectId,
  prospectEmail,
  prospectName,
}: ProspectSignalsDrawerProps) {
  const [signals, setSignals] = useState<SignalDetail[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    fetch(`/api/prospects/${prospectId}/signals`)
      .then(r => r.json())
      .then(j => setSignals(j.signals ?? []))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [open, prospectId])

  // Reset on close
  useEffect(() => {
    if (!open) {
      setSignals([])
      setError(null)
    }
  }, [open])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col overflow-hidden border-l border-[#e8e3dc]"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#e8e3dc] px-6 py-4 flex items-start justify-between flex-shrink-0">
          <div>
            <p className="text-xs text-[#8a7e6e] uppercase tracking-wide mb-1">Prospect</p>
            <p className="text-base font-semibold text-[#1a1a2e]">{prospectName || prospectEmail}</p>
            {prospectName && <p className="text-xs text-[#8a7e6e]">{prospectEmail}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <h3 className="text-sm font-semibold text-[#1a1a2e] mb-3">
            Active signals ({loading ? '…' : signals.length})
          </h3>

          {loading && <p className="text-sm text-[#8a7e6e]">Loading signals…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && signals.length === 0 && (
            <p className="text-sm text-[#8a7e6e]">No signals detected for this prospect yet.</p>
          )}

          <div className="flex flex-col gap-3">
            {signals.map(s => (
              <div key={s.id} className="border border-[#e8e3dc] rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-sm font-semibold text-[#1a1a2e]">📡 {s.signals.name}</p>
                  <span className="text-xs text-[#8a7e6e] flex-shrink-0 ml-2">{formatRelative(s.detected_at)}</span>
                </div>
                {s.signals.description && (
                  <p className="text-xs text-[#8a7e6e] mb-2">{s.signals.description}</p>
                )}
                {Object.keys(s.signal_data).length > 0 && (
                  <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-lg p-2 mb-2">
                    <p className="text-xs font-medium text-[#3b6bef] mb-1">Detected:</p>
                    <pre className="text-xs text-[#6b5e4e] whitespace-pre-wrap font-mono leading-relaxed">
                      {JSON.stringify(s.signal_data, null, 2)}
                    </pre>
                  </div>
                )}
                {s.source_url && (() => {
                  const safe = safeExternalHref(s.source_url);
                  return safe ? (
                    <a
                      href={safe}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#3b6bef] hover:underline break-all"
                    >
                      Source ↗ {s.source_url}
                    </a>
                  ) : (
                    <span className="text-xs text-[#8a7e6e] break-all" title={s.source_url}>
                      Source: {s.source_url} (invalid URL — not linked)
                    </span>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  )
}
