'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
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
  prospects_scanned: number
  matches_found: number
  status: 'executed' | 'queued'
  block_reason?: string
  empty_reason?: 'no_prospects' | 'all_on_cooldown'
}

export function RunSignalModal({ isOpen, onClose, signalId, signalName, onComplete }: RunSignalModalProps) {
  const t = useTranslations('dashboard.signals.run')
  const tCommon = useTranslations('dashboard.common')
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
        .catch(() => setError(t('errorLoadCampaigns')))
        .finally(() => setLoadingCampaigns(false))
    }
    // t is stable per-namespace.
  }, [isOpen, step, campaigns.length, t])

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
        setError(data?.error ?? t('scanFailed'))
        setStep('confirm')
        return
      }
      setScanResult({
        prospects_scanned: data.prospects_scanned ?? 0,
        matches_found: data.matches_found ?? 0,
        status: data.status,
        block_reason: data.block_reason,
        empty_reason: data.empty_reason,
      })
      setStep('complete')
      onComplete()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('networkError'))
      setStep('confirm')
    }
  }

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId)

  const titles: Record<Step, string> = {
    select_campaign: t('titleRunSignal', { name: signalName }),
    confirm: t('titleRunSignal', { name: signalName }),
    running: t('titleScanning'),
    complete: t('titleScanComplete'),
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
          <p className="text-sm text-[#8a7e6e]">{t('selectCampaignPrompt')}</p>
          {loadingCampaigns ? (
            <p className="text-sm text-[#8a7e6e]">{t('loadingCampaigns')}</p>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-red-600">{t('noCampaignsFound')}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="campaign-select" className="text-xs font-semibold text-[#4a4a5a] uppercase tracking-wider">
                {t('campaignLabel')}
              </label>
              <select
                id="campaign-select"
                value={selectedCampaignId}
                onChange={e => setSelectedCampaignId(e.target.value)}
                className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-1"
              >
                <option value="">{t('selectCampaignPlaceholder')}</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2 text-sm hover:bg-[#f7f4f0] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-1"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={() => setStep('confirm')}
              disabled={!selectedCampaignId}
              className="bg-[#3b6bef] text-white rounded-lg px-4 py-2 text-sm hover:bg-[#2d5cdc] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-1"
            >
              {tCommon('continue')}
            </button>
          </div>
        </div>
      )}

      {/* Step 2 : confirm */}
      {step === 'confirm' && (
        <div className="flex flex-col gap-4">
          <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-xl p-4">
            <p className="text-sm font-semibold text-[#1a1a2e] mb-2">{t('readyToScan')}</p>
            <ul className="space-y-1.5 text-xs text-[#6b5e4e]">
              <li><span aria-hidden="true">📡</span> {t('confirmSignalPrefix')} <span className="font-medium text-[#1a1a2e]">{signalName}</span></li>
              <li><span aria-hidden="true">🎯</span> {t('confirmCampaignPrefix')} <span className="font-medium text-[#1a1a2e]">{selectedCampaign?.name}</span></li>
              <li><span aria-hidden="true">⏱</span> {t('confirmEstimatedTime')}</li>
              <li><span aria-hidden="true">🤖</span> {t('confirmScanLimit')}</li>
              <li><span aria-hidden="true">💰</span> {t('confirmAiCost')}</li>
            </ul>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 justify-between">
            <button
              onClick={() => setStep('select_campaign')}
              className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2 text-sm hover:bg-[#f7f4f0] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-1"
            >
              {tCommon('back')}
            </button>
            <button
              onClick={handleRun}
              className="bg-[#3b6bef] text-white rounded-lg px-4 py-2 text-sm hover:bg-[#2d5cdc] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-1"
            >
              {t('runScan')}
            </button>
          </div>
        </div>
      )}

      {/* Step 3 : running */}
      {step === 'running' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div
            role="status"
            aria-label={t('scanInProgressAria')}
            className="w-12 h-12 border-4 border-[#dde6fd] border-t-[#3b6bef] rounded-full animate-spin"
          />
          <div className="text-center">
            <p className="text-sm font-semibold text-[#1a1a2e]">{t('scanningLabel')}</p>
            <p className="text-xs text-[#8a7e6e] mt-1">{t('elapsed', { seconds: elapsedSec })}</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 text-center">
            <span aria-hidden="true">⚠️</span> {t('dontClose')}
          </div>
        </div>
      )}

      {/* Step 4 : complete */}
      {step === 'complete' && scanResult && (
        <div className="flex flex-col gap-4">
          {scanResult.status === 'queued' ? (
            <div role="status" aria-live="polite" className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
              <p className="text-3xl mb-2">⏳</p>
              <p className="text-sm font-semibold text-amber-700 mb-1">
                {scanResult.block_reason === 'monthly_cap'
                  ? t('queuedMonthlyCap')
                  : t('queuedThrottled')}
              </p>
              <p className="text-xs text-amber-600 mt-1">{t('queuedSubtext')}</p>
            </div>
          ) : scanResult.prospects_scanned === 0 ? (
            <div role="status" aria-live="polite" className="bg-[#f7f4f0] border border-[#e8e3dc] rounded-xl p-4 text-center">
              <p className="text-3xl mb-2">○</p>
              {scanResult.empty_reason === 'all_on_cooldown' ? (
                <>
                  <p className="text-sm font-semibold text-[#4a4a5a] mb-1">{t('noProspectsCooldownTitle')}</p>
                  <p className="text-xs text-[#8a7e6e] mt-1">{t('noProspectsCooldownSubtext')}</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-[#4a4a5a] mb-1">{t('noProspectsToScanTitle')}</p>
                  <p className="text-xs text-[#8a7e6e] mt-1">{t('noProspectsToScanSubtext')}</p>
                </>
              )}
            </div>
          ) : (
            <div role="status" aria-live="polite" className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <p className="text-3xl mb-2">✓</p>
              <p className="text-sm font-semibold text-green-700 mb-1">{t('scanCompleteHeading')}</p>
              <p className="text-2xl font-bold text-[#1a1a2e]">
                {t('matchedFormat', { matches: scanResult.matches_found, scanned: scanResult.prospects_scanned })}
              </p>
            </div>
          )}
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="bg-[#3b6bef] text-white rounded-lg px-4 py-2 text-sm hover:bg-[#2d5cdc] transition-colors"
            >
              {tCommon('done')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
