'use client'
import { useEffect, useRef, useState } from 'react'

interface Props {
  campaignId:    string
  prospectCount: number
  stepCount:     number
  onClose:       () => void
  onGenerated:   () => void
}

export function GenerateDraftsModal({ campaignId, prospectCount, stepCount, onClose, onGenerated }: Props) {
  const [mode, setMode]               = useState<'fast' | 'smart'>('smart')
  const [generating, setGenerating]   = useState(false)
  const [progressCount, setProgressCount] = useState(0)
  const [error, setError]             = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const totalExpected = prospectCount * stepCount
  const progress = totalExpected > 0 ? Math.min(100, Math.round((progressCount / totalExpected) * 100)) : 0
  const estimatedSeconds = mode === 'smart' ? Math.max(5, Math.round(prospectCount * 0.6)) : null

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  useEffect(() => () => stopPoll(), [])

  async function handleGenerate() {
    setGenerating(true)
    setError('')
    setProgressCount(0)

    // Poll for progress every 2s while generation runs
    pollRef.current = setInterval(async () => {
      try {
        const d = await fetch(`/api/prospect-emails?campaign_id=${campaignId}&page=1&limit=1`).then(r => r.json())
        if (d.total > 0) setProgressCount(d.total)
      } catch {}
    }, 2000)

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/generate-drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      }).then(r => r.json())

      stopPoll()

      if (res.error) {
        setError(res.error)
        setGenerating(false)
        return
      }

      setProgressCount(res.generated_count + (res.skipped_existing ?? 0))
      onGenerated()
    } catch {
      stopPoll()
      setError('Generation failed. Please try again.')
      setGenerating(false)
    }
  }

  // ── Loading state ────────────────────────────────────────────────────────────
  if (generating) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-8 text-center">
          <div className="text-3xl mb-4">✨</div>
          <h2 className="text-base font-bold text-[#1a1a2e] mb-4">
            {mode === 'smart' ? 'Sentra AI is personalizing your emails…' : 'Generating emails…'}
          </h2>

          <div className="w-full bg-[#f0ece6] rounded-full h-2 mb-3">
            <div
              className="bg-[#3b6bef] h-2 rounded-full transition-all duration-700"
              style={{ width: `${Math.max(4, progress)}%` }}
            />
          </div>

          <p className="text-sm text-[#6b5e4e] mb-4">
            {progressCount > 0
              ? `${progressCount} of ${totalExpected} emails done`
              : `Preparing ${totalExpected} emails…`}
          </p>

          <div className="text-xs text-[#b0a898] space-y-0.5">
            <div>Mode: {mode === 'smart' ? 'Smart' : 'Fast'}</div>
            {mode === 'smart' && <div>Email 1: AI personalization · Follow-ups: Template</div>}
          </div>
        </div>
      </div>
    )
  }

  // ── Mode selector ────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between p-5 border-b border-[#f0ece6]">
          <h2 className="text-base font-bold text-[#1a1a2e]">
            Generate emails for {prospectCount} prospect{prospectCount !== 1 ? 's' : ''}
          </h2>
          <button onClick={onClose} className="text-[#8a7e6e] hover:text-[#1a1a2e] text-xl leading-none">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            {/* Fast */}
            <button
              onClick={() => setMode('fast')}
              className={`text-left rounded-xl border-2 p-4 transition-all ${
                mode === 'fast'
                  ? 'border-[#3b6bef] bg-[#eef1fd]'
                  : 'border-[#e8e3dc] hover:border-[#3b6bef]/40'
              }`}
            >
              <div className="text-2xl mb-2">⚡</div>
              <div className="font-semibold text-sm text-[#1a1a2e] mb-1">Fast</div>
              <div className="text-xs text-[#6b5e4e] mb-3">
                Same email for everyone, with name and company auto-filled.
              </div>
              <div className="text-xs text-[#8a7e6e] space-y-0.5">
                <div>⏱ Ready in seconds</div>
                <div>💸 No AI cost</div>
              </div>
            </button>

            {/* Smart */}
            <button
              onClick={() => setMode('smart')}
              className={`text-left rounded-xl border-2 p-4 transition-all relative ${
                mode === 'smart'
                  ? 'border-[#3b6bef] bg-[#eef1fd]'
                  : 'border-[#e8e3dc] hover:border-[#3b6bef]/40'
              }`}
            >
              <span className="absolute top-3 right-3 text-[9px] bg-[#3b6bef] text-white px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide">
                Recommended
              </span>
              <div className="text-2xl mb-2">🎯</div>
              <div className="font-semibold text-sm text-[#1a1a2e] mb-1">Smart</div>
              <div className="text-xs text-[#6b5e4e] mb-3">
                AI writes a unique opening line for each prospect based on their company and role.
              </div>
              <div className="text-xs text-[#8a7e6e] space-y-0.5">
                {estimatedSeconds && <div>⏱ ~{estimatedSeconds}s for {prospectCount} prospects</div>}
                <div>✨ AI personalization included</div>
              </div>
            </button>
          </div>

          <p className="text-xs text-[#8a7e6e]">
            Follow-ups use your template with auto-filled variables. You can edit any draft after generation.
          </p>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button onClick={onClose}
              className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm">
              Cancel
            </button>
            <button onClick={handleGenerate}
              className="flex-1 bg-[#3b6bef] text-white rounded-lg py-2 text-sm font-semibold">
              Generate {totalExpected} draft{totalExpected !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
