'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CampaignTemplate } from '@/lib/campaign-templates'

interface Props {
  preset: CampaignTemplate | null
  isFromAI: boolean
  onClose: () => void
}

export function NewCampaignModal({ preset, isFromAI, onClose }: Props) {
  const router = useRouter()

  const [name, setName]             = useState(preset && preset.id !== 'blank' ? preset.label : '')
  const [targetPersona, setPersona] = useState(preset?.target_persona ?? '')
  const [angle, setAngle]           = useState(preset?.angle ?? '')
  const [valueProp, setValueProp]   = useState(preset?.value_prop ?? '')
  const [cta, setCta]               = useState(preset?.cta ?? '')
  const [creating, setCreating]     = useState(false)
  const [error, setError]           = useState('')

  async function handleCreate() {
    if (!name.trim()) { setError('Campaign name is required.'); return }
    setCreating(true)
    setError('')

    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        angle: angle.trim() || null,
        value_prop: valueProp.trim() || null,
        cta: cta.trim() || null,
        target_persona: targetPersona.trim() || null,
      }),
    }).then(r => r.json())

    if (res.error) {
      setError(res.error)
      setCreating(false)
      return
    }

    router.push(`/dashboard/campaigns/${res.campaign.id}`)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0ece6]">
          <h2 className="text-base font-bold text-[#1a1a2e]">New Campaign</h2>
          <button onClick={onClose} className="text-[#8a7e6e] hover:text-[#1a1a2e] text-xl leading-none">✕</button>
        </div>

        <div className="overflow-y-auto px-6 py-5 flex flex-col gap-4">
          {isFromAI && (
            <div className="flex items-center gap-2 bg-[#eef1fd] border border-[#3b6bef]/20 rounded-lg px-3 py-2 text-xs text-[#3b6bef] font-medium">
              <span>✨</span>
              <span>Pre-filled from AI suggestion</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[#4a4a5a] uppercase tracking-wider mb-1.5">
              Campaign Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. SaaS VP Outreach Q3"
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#4a4a5a] uppercase tracking-wider mb-1.5">Target Persona</label>
            <textarea
              value={targetPersona}
              onChange={e => setPersona(e.target.value)}
              placeholder="e.g. VP of Sales at B2B SaaS companies with 50-500 employees"
              rows={2}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#4a4a5a] uppercase tracking-wider mb-1.5">Angle</label>
            <textarea
              value={angle}
              onChange={e => setAngle(e.target.value)}
              placeholder="e.g. Help {{company}} reduce customer churn by 30%"
              rows={2}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#4a4a5a] uppercase tracking-wider mb-1.5">Value Proposition</label>
            <textarea
              value={valueProp}
              onChange={e => setValueProp(e.target.value)}
              placeholder="e.g. Teams using our product cut onboarding time by 40%"
              rows={2}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#4a4a5a] uppercase tracking-wider mb-1.5">Call to Action</label>
            <textarea
              value={cta}
              onChange={e => setCta(e.target.value)}
              placeholder="e.g. Would you be open to a 20-minute demo this week?"
              rows={2}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[#f0ece6] flex gap-2">
          <button
            onClick={onClose}
            disabled={creating}
            className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex-1 bg-[#3b6bef] hover:bg-[#2a5bdf] text-white rounded-lg py-2 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create Campaign'}
          </button>
        </div>
      </div>
    </div>
  )
}
