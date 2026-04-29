'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CampaignTemplate } from '@/lib/campaign-templates'

const SIZE_OPTIONS = ['1-10', '11-50', '51-200', '201-1000', '1000+']
const REV_OPTIONS  = ['<$1M', '$1M-$5M', '$5M-$10M', '$10M-$50M', '$50M-$200M', '$200M+']
const TONES        = ['Professional', 'Casual', 'Direct', 'Friendly', 'Witty']
const LANGUAGES    = ['English', 'French', 'German', 'Spanish', 'Italian']

function extractNums(str: string): number[] {
  return (str.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
}

function near(a: number, b: number) {
  if (b === 0) return a === 0
  return Math.abs(a - b) / b <= 0.05
}

function matchSizePills(str: string): string[] {
  const ns = extractNums(str)
  return SIZE_OPTIONS.filter(opt => {
    const on = extractNums(opt)
    return ns.some(n => on.some(o => near(n, o)))
  })
}

function matchRevenuePills(str: string): string[] {
  const stripM = (s: string) => s.replace(/\$?(\d+(?:\.\d+)?)M/gi, (_, n) => n)
  const ns = extractNums(stripM(str))
  return REV_OPTIONS.filter(opt => {
    const on = extractNums(stripM(opt))
    return ns.some(n => on.some(o => near(n, o)))
  })
}

interface Props {
  preset: CampaignTemplate | null
  isFromAI: boolean
  onClose: () => void
}

export function NewCampaignModal({ preset, isFromAI, onClose }: Props) {
  const router    = useRouter()
  const isTemplate = !!preset && preset.id !== 'blank'

  const [name,           setName]           = useState(isTemplate ? preset!.label : '')
  const [icpText,        setIcpText]        = useState('')
  const [targetIndustry, setTargetIndustry] = useState('')
  const [targetTitles,   setTargetTitles]   = useState('')
  const [targetRegions,  setTargetRegions]  = useState('')
  const [selectedSizes,  setSelectedSizes]  = useState<string[]>([])
  const [selectedRevs,   setSelectedRevs]   = useState<string[]>([])
  const [valueProp,      setValueProp]      = useState(preset?.value_prop ?? '')
  const [angle,          setAngle]          = useState(preset?.angle ?? '')
  const [cta,            setCta]            = useState(preset?.cta ?? '')
  const [targetPersona,  setTargetPersona]  = useState(preset?.target_persona ?? '')
  const [tone,           setTone]           = useState('Professional')
  const [language,       setLanguage]       = useState('English')
  const [parsing,        setParsing]        = useState(false)
  const [creating,       setCreating]       = useState(false)
  const [error,          setError]          = useState('')

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
      if (icp.industries?.length)  setTargetIndustry(icp.industries.join(', '))
      if (icp.titles?.length)      setTargetTitles(icp.titles.join(', '))
      if (icp.regions?.length)     setTargetRegions(icp.regions.join(', '))
      if (icp.summary)             setTargetPersona(icp.summary)
      if (icp.company_size)        setSelectedSizes(matchSizePills(icp.company_size))
      if (icp.revenue)             setSelectedRevs(matchRevenuePills(icp.revenue))
    } finally {
      setParsing(false)
    }
  }

  async function handleCreate() {
    if (!name.trim()) { setError('Campaign name is required.'); return }
    setCreating(true)
    setError('')

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

    if (res.error) { setError(res.error); setCreating(false); return }
    router.push(`/dashboard/campaigns/${res.campaign.id}`)
  }

  const inputCls = 'w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]'
  const labelCls = 'block text-xs font-semibold text-[#4a4a5a] uppercase tracking-wider mb-1.5'
  const secCls   = 'text-xs font-bold text-[#1a1a2e] uppercase tracking-wider mb-3 pb-1.5 border-b border-[#f0ece6]'

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

          {/* Parse with AI */}
          <div>
            <p className={secCls}>Parse with AI</p>
            <textarea
              value={icpText}
              onChange={e => setIcpText(e.target.value)}
              placeholder="Paste any description of your ideal customer — a job spec, LinkedIn search, sales brief… AI will extract the structured fields below."
              rows={3}
              className={`${inputCls} resize-none`}
            />
            <button
              onClick={handleParseWithAI}
              disabled={parsing || !icpText.trim()}
              className="mt-2 flex items-center gap-1.5 bg-[#6b4de6] hover:bg-[#5a3dd5] text-white text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40"
            >
              {parsing ? 'Parsing…' : '✨ Parse with AI'}
            </button>
          </div>

          {/* Campaign Name */}
          <div>
            <label className={labelCls}>Campaign Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. SaaS VP Outreach Q3"
              className={inputCls}
            />
          </div>

          {/* Define Your Ideal Customer */}
          <div>
            <p className={secCls}>Define Your Ideal Customer</p>
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
                    <button
                      key={opt}
                      onClick={() => togglePill(selectedSizes, opt, setSelectedSizes)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        selectedSizes.includes(opt)
                          ? 'bg-[#3b6bef] border-[#3b6bef] text-white'
                          : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#3b6bef]'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>Company Revenue</label>
                <div className="flex flex-wrap gap-2">
                  {REV_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      onClick={() => togglePill(selectedRevs, opt, setSelectedRevs)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        selectedRevs.includes(opt)
                          ? 'bg-[#3b6bef] border-[#3b6bef] text-white'
                          : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#3b6bef]'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Your Pitch */}
          <div>
            <p className={secCls}>Your Pitch</p>
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
