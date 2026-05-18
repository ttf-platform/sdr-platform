'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CampaignTemplate } from '@/lib/campaign-templates'
import { track } from '@/lib/track'

const SIZE_OPTIONS = ['1-10', '11-50', '51-200', '201-1000', '1000+']
const REV_OPTIONS  = ['<$1M', '$1M-$5M', '$5M-$10M', '$10M-$50M', '$50M-$200M', '$200M+']
const TONES        = ['Professional', 'Casual', 'Direct', 'Friendly', 'Witty']
const LANGUAGES    = ['English', 'French', 'German', 'Spanish', 'Italian']

interface Props {
  preset: CampaignTemplate | null
  isFromAI: boolean
  onClose: () => void
}

export function NewCampaignModal({ preset, isFromAI, onClose }: Props) {
  const router     = useRouter()
  const isTemplate = !!preset && preset.id !== 'blank'

  const [name,           setName]           = useState(isTemplate ? preset!.label : '')
  const [icpText,        setIcpText]        = useState('')
  const [targetIndustry, setTargetIndustry] = useState('')
  const [targetTitles,   setTargetTitles]   = useState('')
  const [targetRegions,  setTargetRegions]  = useState('')
  const [selectedSizes,  setSelectedSizes]  = useState<string[]>([])
  const [selectedRevs,   setSelectedRevs]   = useState<string[]>([])
  const [angle,          setAngle]          = useState(preset?.angle ?? '')
  const [valueProp,      setValueProp]      = useState(preset?.value_prop ?? '')
  const [cta,            setCta]            = useState(preset?.cta ?? '')
  const [targetPersona,  setTargetPersona]  = useState(preset?.target_persona ?? '')
  const [tone,           setTone]           = useState('Professional')
  const [language,       setLanguage]       = useState('English')
  const [parsing,        setParsing]        = useState(false)
  const [creating,       setCreating]       = useState(false)
  const [error,          setError]          = useState('')
  const [nameError,      setNameError]      = useState('')
  const [nameFlashing,   setNameFlashing]   = useState(false)
  const nameInputRef  = useRef<HTMLInputElement>(null)
  const checkDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mount check: if name is pre-filled (template / AI suggestion), verify availability
  useEffect(() => {
    if (name.trim()) scheduleNameCheck(name, 600)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Bug G — pre-fill ICP textarea with Master ICP on mount (only if empty)
  useEffect(() => {
    fetch('/api/workspace/booking-profile')
      .then(r => r.json())
      .then(d => {
        const desc = d.profile?.icp_description
        if (desc && !icpText) setIcpText(desc)
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function togglePill(arr: string[], val: string, setter: (v: string[]) => void) {
    setter(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val])
  }

  async function handleParseWithAI() {
    if (!icpText.trim()) return
    setParsing(true)
    try {
      const res = await fetch('/api/icp/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: icpText.trim() }),
      }).then(r => r.json())
      const icp = res.icp
      if (!icp) return
      // Exact pill arrays from API — no fuzzy matching needed
      if (icp.industries?.length)    setTargetIndustry(icp.industries.join(', '))
      if (icp.titles?.length)        setTargetTitles(icp.titles.join(', '))
      if (icp.regions?.length)       setTargetRegions(icp.regions.join(', '))
      if (icp.summary)               setTargetPersona(icp.summary)
      if (icp.company_sizes?.length) setSelectedSizes(icp.company_sizes)
      if (icp.revenue?.length)       setSelectedRevs(icp.revenue)
    } finally {
      setParsing(false)
    }
  }

  async function checkNameAvailable(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    const res = await fetch(`/api/campaigns/check-name?name=${encodeURIComponent(trimmed)}`).then(r => r.json()).catch(() => null)
    if (res && !res.available) {
      setNameError('⚠️ A campaign with this name already exists. Please choose a different name.')
    }
  }

  function scheduleNameCheck(value: string, delayMs = 500) {
    if (checkDebounce.current) clearTimeout(checkDebounce.current)
    checkDebounce.current = setTimeout(() => checkNameAvailable(value), delayMs)
  }

  function handleNameBlur() {
    if (nameError) return // already showing error, don't re-check
    scheduleNameCheck(name, 0) // immediate on blur
  }

  function flashNameField() {
    setNameFlashing(true)
    nameInputRef.current?.focus()
    nameInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => setNameFlashing(false), 900)
  }

  async function handleCreate() {
    if (!name.trim()) { setNameError('Campaign name is required.'); flashNameField(); return }
    if (nameError) { flashNameField(); return }
    setCreating(true)
    setError('')
    setNameError('')

    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:            name.trim(),
        angle:           angle.trim()          || null,
        value_prop:      valueProp.trim()      || null,
        cta:             cta.trim()            || null,
        target_persona:  targetPersona.trim()  || null,
        target_industry: targetIndustry.trim() || null,
        target_titles:   targetTitles.trim()   || null,
        target_regions:  targetRegions.trim()  || null,
        company_sizes:   selectedSizes.length  ? selectedSizes  : null,
        company_revenue: selectedRevs.length   ? selectedRevs   : null,
        tone,
        language,
      }),
    }).then(r => r.json())

    if (res.error === 'duplicate_name') {
      setNameError('⚠️ A campaign with this name already exists. Please choose a different name.')
      setCreating(false)
      flashNameField()
      return
    }
    if (res.error) { setError(res.error); setCreating(false); return }
    track('campaign_created', { campaign_id: res.campaign.id, has_steps: false })
    router.push(`/dashboard/campaigns/${res.campaign.id}`)
  }

  const inputCls = 'w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]'
  const labelCls = 'block text-xs font-semibold text-[#4a4a5a] uppercase tracking-wider mb-1.5'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0ece6]">
          <h2 className="text-base font-bold text-[#1a1a2e]">New Campaign</h2>
          <button onClick={onClose} className="text-[#8a7e6e] hover:text-[#1a1a2e] text-xl leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 flex flex-col gap-5">

          {/* Badges */}
          {isFromAI && (
            <div className="flex items-center gap-2 bg-[#eef1fd] border border-[#3b6bef]/20 rounded-lg px-3 py-2 text-xs text-[#3b6bef] font-medium">
              <span>✨</span><span>Pre-filled from AI suggestion</span>
            </div>
          )}
          {!isFromAI && isTemplate && (
            <div className="flex items-center gap-2 bg-[#f5f0e8] border border-[#c8a96e]/20 rounded-lg px-3 py-2 text-xs text-[#8b6914] font-medium">
              <span>🎯</span><span>Pre-filled from template</span>
            </div>
          )}

          {/* Bug H — ICP section with clarified header */}
          <div>
            <div className="mb-3 pb-1.5 border-b border-[#f0ece6]">
              <h3 className="text-xs font-bold text-[#1a1a2e] uppercase tracking-wider">🎯 ICP — Ideal Customer Profile</h3>
              <p className="text-xs text-[#8a7e6e] mt-0.5">
                Pre-filled from your Master ICP. Edit and click Parse with AI to update the structured fields below for this campaign only.
              </p>
            </div>
            <textarea
              value={icpText}
              onChange={e => setIcpText(e.target.value)}
              placeholder="Founders of B2B SaaS companies in Europe, 11-50 employees, focused on outbound sales..."
              rows={3}
              className={`${inputCls} resize-none`}
            />
            <div className="mt-2 flex items-start gap-3">
              <button
                onClick={handleParseWithAI}
                disabled={parsing || !icpText.trim()}
                className="shrink-0 flex items-center gap-1.5 bg-[#6b4de6] hover:bg-[#5a3dd5] text-white text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40"
              >
                {parsing ? 'Parsing…' : '✨ Parse with AI'}
              </button>
              <p className="text-xs text-[#8a7e6e] pt-1">
                This will auto-fill Industry, Titles, Regions, Size and Revenue below.
              </p>
            </div>
          </div>

          {/* Campaign Name */}
          <div>
            <label className={labelCls}>Campaign Name <span className="text-red-500">*</span></label>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={e => {
                const v = e.target.value
                setName(v)
                setNameError('')
                if (v.trim()) scheduleNameCheck(v, 500)
              }}
              onBlur={handleNameBlur}
              placeholder="e.g. SaaS VP Outreach Q3"
              className={`${inputCls} ${nameError ? 'border-red-400' : ''} ${nameFlashing ? 'animate-pulse ring-2 ring-red-300' : ''}`}
            />
            {nameError && <p className="text-xs text-red-600 mt-1">{nameError}</p>}
          </div>

          {/* Define Your Ideal Customer */}
          <div>
            <div className="mb-3 pb-1.5 border-b border-[#f0ece6]">
              <h3 className="text-xs font-bold text-[#1a1a2e] uppercase tracking-wider">Define Your Ideal Customer</h3>
              <p className="text-xs text-[#8a7e6e] mt-0.5">Auto-filled from Parse with AI, or fill manually.</p>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className={labelCls}>Target Industry</label>
                <input type="text" value={targetIndustry} onChange={e => setTargetIndustry(e.target.value)}
                  placeholder="e.g. SaaS, FinTech, Healthcare" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Target Titles</label>
                <input type="text" value={targetTitles} onChange={e => setTargetTitles(e.target.value)}
                  placeholder="e.g. VP of Sales, Head of Growth" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Target Regions</label>
                <input type="text" value={targetRegions} onChange={e => setTargetRegions(e.target.value)}
                  placeholder="e.g. US, UK, DACH" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Company Size</label>
                <div className="flex flex-wrap gap-2">
                  {SIZE_OPTIONS.map(opt => (
                    <button key={opt}
                      onClick={() => togglePill(selectedSizes, opt, setSelectedSizes)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        selectedSizes.includes(opt)
                          ? 'bg-[#3b6bef] border-[#3b6bef] text-white'
                          : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#3b6bef]'
                      }`}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>Company Revenue</label>
                <div className="flex flex-wrap gap-2">
                  {REV_OPTIONS.map(opt => (
                    <button key={opt}
                      onClick={() => togglePill(selectedRevs, opt, setSelectedRevs)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        selectedRevs.includes(opt)
                          ? 'bg-[#3b6bef] border-[#3b6bef] text-white'
                          : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#3b6bef]'
                      }`}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Your Pitch */}
          <div>
            <div className="mb-3 pb-1.5 border-b border-[#f0ece6]">
              <h3 className="text-xs font-bold text-[#1a1a2e] uppercase tracking-wider">Your Pitch</h3>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className={labelCls}>
                  What does your product do? <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={angle}
                  onChange={e => setAngle(e.target.value)}
                  placeholder="e.g. We help B2B teams close more deals with AI-driven intent signals"
                  rows={2}
                  className={`${inputCls} resize-none`}
                />
              </div>
              <div>
                <label className={labelCls}>
                  Value Proposition{' '}
                  <span className="text-[#a89e8e] font-normal normal-case tracking-normal">(optional)</span>
                </label>
                <textarea
                  value={valueProp}
                  onChange={e => setValueProp(e.target.value)}
                  placeholder="e.g. Real-time buying signals from LinkedIn + web activity"
                  rows={2}
                  className={`${inputCls} resize-none`}
                />
              </div>
            </div>
          </div>

          {/* Tone & Language */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Tone</label>
              <select value={tone} onChange={e => setTone(e.target.value)} className={inputCls}>
                {TONES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Language</label>
              <select value={language} onChange={e => setLanguage(e.target.value)} className={inputCls}>
                {LANGUAGES.map(l => <option key={l}>{l}</option>)}
              </select>
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        {/* Footer */}
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
