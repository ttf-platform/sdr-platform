'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'

type Campaign = { id: string; name: string }

type RunSignalModalProps = {
  isOpen: boolean
  onClose: () => void
  signalId: string
  signalName: string
  onComplete: () => void
}

type Step = 'select_campaign' | 'confirm' | 'running' | 'complete'

type RunResult = {
  scanned: number
  matched: number
  errors: number
  skipped: number
}

export function RunSignalModal({ isOpen, onClose, signalId, signalName, onComplete }: RunSignalModalProps) {
  const [step, setStep] = useState<Step>('select_campaign')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<RunResult | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('select_campaign')
      setSelectedCampaignId('')
      setError(null)
      setScanResult(null)
      setElapsedSec(0)
    }
  }, [isOpen])

  // Fetch campaigns when entering step 1
  useEffect(() => {
    if (isOpen && step === 'select_campaign' && campaigns.length === 0) {
      setLoadingCampaigns(true)
      fetch('/api/campaigns')
        .then(r => r.json())
        .then(j => setCampaigns(j.campaigns ?? []))
        .catch(() => setError('Failed to load campaigns'))
        .finally(() => setLoadingCampaigns(false))
    }
  }, [isOpen, step, campaigns.length])

  // Timer during running state
  useEffect(() => {
    if (step !== 'running') return
    const interval = setInterval(() => setElapsedSec(s => s + 1), 1000)
    return () => clearInterval(interval)
  }, [step])

  async function handleRun() {
    setStep('running')
    setElapsedSec(0)
    setError(null)
    try {
      const res = await fetch(`/api/signals/${signalId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: selectedCampaignId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? 'Scan failed')
        setStep('confirm')
        return
      }
      setScanResult({
        scanned: data.scanned ?? 0,
        matched: data.matched ?? 0,
        errors: data.errors ?? 0,
        skipped: data.skipped ?? 0,
      })
      setStep('complete')
      onComplete()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
      setStep('confirm')
    }
  }

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId)

  const titles: Record<Step, string> = {
    select_campaign: `Run signal: ${signalName}`,
    confirm: `Run signal: ${signalName}`,
    running: 'Scanning…',
    complete: 'Scan complete',
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={step === 'running' ? () => {} : onClose}
      title={titles[step]}
      size="md"
      closeOnBackdropClick={step !== 'running'}
      closeOnEscape={step !== 'running'}
    >
      {/* Step 1 : select campaign */}
      {step === 'select_campaign' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[#8a7e6e]">Choose the campaign whose prospects you want to scan for this signal.</p>
          {loadingCampaigns ? (
            <p className="text-sm text-[#8a7e6e]">Loading campaigns…</p>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-red-600">No campaigns found. Create a campaign first.</p>
          ) : (
            <select
              value={selectedCampaignId}
              onChange={e => setSelectedCampaignId(e.target.value)}
              className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm bg-white focus-visible:outline-none focus-visible:border-[#3b6bef]"
            >
              <option value="">— Select a campaign —</option>
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2 text-sm hover:bg-[#f7f4f0] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => setStep('confirm')}
              disabled={!selectedCampaignId}
              className="bg-[#3b6bef] text-white rounded-lg px-4 py-2 text-sm hover:bg-[#2d5cdc] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* Step 2 : confirm */}
      {step === 'confirm' && (
        <div className="flex flex-col gap-4">
          <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-xl p-4">
            <p className="text-sm font-semibold text-[#1a1a2e] mb-2">Ready to scan</p>
            <ul className="space-y-1.5 text-xs text-[#6b5e4e]">
              <li>📡 Signal: <span className="font-medium text-[#1a1a2e]">{signalName}</span></li>
              <li>🎯 Campaign: <span className="font-medium text-[#1a1a2e]">{selectedCampaign?.name}</span></li>
              <li>⏱ Estimated time: 30 – 80 seconds</li>
              <li>🤖 Sentra AI will scan up to 30 prospects per Run (V1 limit)</li>
              <li>💰 AI cost is included in your plan</li>
            </ul>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 justify-between">
            <button
              onClick={() => setStep('select_campaign')}
              className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2 text-sm hover:bg-[#f7f4f0] transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={handleRun}
              className="bg-[#3b6bef] text-white rounded-lg px-4 py-2 text-sm hover:bg-[#2d5cdc] transition-colors"
            >
              ▶ Run scan
            </button>
          </div>
        </div>
      )}

      {/* Step 3 : running */}
      {step === 'running' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="w-12 h-12 border-4 border-[#dde6fd] border-t-[#3b6bef] rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-sm font-semibold text-[#1a1a2e]">Sentra AI is scanning your prospects…</p>
            <p className="text-xs text-[#8a7e6e] mt-1">Elapsed: {elapsedSec}s</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 text-center max-w-sm">
            ⚠️ Don&apos;t close this window. The scan will take 30 – 80 seconds.
          </div>
        </div>
      )}

      {/* Step 4 : complete */}
      {step === 'complete' && scanResult && (
        <div className="flex flex-col gap-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
            <p className="text-3xl mb-2">✓</p>
            <p className="text-sm font-semibold text-green-700 mb-1">Scan complete</p>
            <p className="text-2xl font-bold text-[#1a1a2e]">
              {scanResult.matched}{' '}
              <span className="text-base font-normal text-[#8a7e6e]">of {scanResult.scanned} prospects matched</span>
            </p>
            {scanResult.errors > 0 && (
              <p className="text-xs text-amber-600 mt-2">{scanResult.errors} error{scanResult.errors !== 1 ? 's' : ''} (check logs)</p>
            )}
            {scanResult.skipped > 0 && (
              <p className="text-xs text-[#8a7e6e] mt-1">{scanResult.skipped} prospect{scanResult.skipped !== 1 ? 's' : ''} skipped (V1 cap at 30 per Run)</p>
            )}
          </div>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="bg-[#3b6bef] text-white rounded-lg px-4 py-2 text-sm hover:bg-[#2d5cdc] transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
