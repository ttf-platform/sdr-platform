'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import ProfileQualityBadge from '@/components/ProfileQualityBadge'
import { calculateProfileScore } from '@/lib/profile-quality'

const supabase = createClient()

function ctaOptions(meetingDuration: number) {
  return [
    `Book a ${meetingDuration}-min discovery call`,
    'Quick 5-min reply if relevant?',
    'Reply with YES if interested',
    'Schedule a demo',
    'Let me know your thoughts',
  ]
}

const LOADING_MESSAGES = [
  'Analyzing your value prop…',
  'Crafting subject lines…',
  'Writing follow-ups…',
  'Applying your tone…',
]

interface Step {
  id: string; step_order: number; step_type: 'initial' | 'follow_up'
  delay_days: number; subject: string | null; body: string; include_booking_link: boolean
}

function SuggestionPills({ items, selected, onSelect, loading }: {
  items: string[]; selected: string; onSelect: (s: string) => void; loading: boolean
}) {
  if (loading) return (
    <div className="flex items-center gap-2 text-xs text-[#8a7e6e] py-2">
      <span className="w-3.5 h-3.5 border-2 border-[#3b6bef]/30 border-t-[#3b6bef] rounded-full animate-spin flex-shrink-0" />
      Sentra AI is thinking…
    </div>
  )
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <button key={i} type="button" onClick={() => onSelect(item)}
          className={`text-left px-3 py-2.5 rounded-xl text-sm border transition-colors leading-snug ${selected === item ? 'border-[#3b6bef] bg-[#eef1fd] text-[#1a1a2e] font-medium' : 'border-[#e8e3dc] bg-white text-[#4a4a5a] hover:border-[#c8d4e8]'}`}>
          <span className="text-[#3b6bef] font-bold mr-1.5">{selected === item ? '✓' : `${i + 1}.`}</span>{item}
        </button>
      ))}
    </div>
  )
}

export default function NewCampaignPage() {
  const [profile, setProfile] = useState<any>(null)
  const [profileScore, setProfileScore] = useState<number | null>(null)
  const [uiStep, setUiStep] = useState(0)
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [error, setError] = useState('')

  // Form state
  const [name, setName] = useState('')
  const [targetPersona, setTargetPersona] = useState('')
  const [angle, setAngle] = useState('')
  const [valueProp, setValueProp] = useState('')
  const [cta, setCta] = useState('')
  const [customCta, setCustomCta] = useState('')
  const [smartStopReply, setSmartStopReply] = useState(true)
  const [smartStopBounce, setSmartStopBounce] = useState(true)

  // Suggestion state
  const [personaSuggestions, setPersonaSuggestions] = useState<string[]>([])
  const [angleSuggestions, setAngleSuggestions] = useState<string[]>([])
  const [valuePropSuggestions, setValuePropSuggestions] = useState<string[]>([])
  const [loadingPersonas, setLoadingPersonas] = useState(false)
  const [loadingAngles, setLoadingAngles] = useState(false)
  const [loadingValueProps, setLoadingValueProps] = useState(false)
  const [showCustomPersona, setShowCustomPersona] = useState(false)
  const [showCustomAngle, setShowCustomAngle] = useState(false)
  const [showCustomValueProp, setShowCustomValueProp] = useState(false)
  const [showCustomCta, setShowCustomCta] = useState(false)

  // Sequence gen
  const [generating, setGenerating] = useState(false)
  const [generatingStep, setGeneratingStep] = useState<string | null>(null)
  const [loadingMsg, setLoadingMsg] = useState(0)
  const [saving, setSaving] = useState(false)
  const loadingInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      const { data: member } = await supabase.from('workspace_members').select('workspace_id').eq('user_id', session.user.id).single()
      if (!member) return
      const { data: p } = await supabase.from('workspace_profiles').select('*').eq('workspace_id', member.workspace_id).single()
      setProfile(p)
      setProfileScore(calculateProfileScore(p ?? {}))
    })
  }, [])

  useEffect(() => {
    if (generating) {
      loadingInterval.current = setInterval(() => setLoadingMsg(i => (i + 1) % LOADING_MESSAGES.length), 3000)
    } else {
      if (loadingInterval.current) clearInterval(loadingInterval.current)
    }
    return () => { if (loadingInterval.current) clearInterval(loadingInterval.current) }
  }, [generating])

  // ── Fetch suggestions ──────────────────────────────────────────────────────
  async function fetchPersonas() {
    if (!name.trim()) return
    setLoadingPersonas(true)
    setPersonaSuggestions([])
    const res = await fetch('/api/campaigns/suggest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_name: name }),
    }).then(r => r.json())
    setPersonaSuggestions(res.target_personas ?? [])
    setLoadingPersonas(false)
  }

  async function fetchAngles() {
    setLoadingAngles(true)
    setAngleSuggestions([])
    const res = await fetch('/api/campaigns/suggest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_name: name, target_persona: targetPersona }),
    }).then(r => r.json())
    setAngleSuggestions(res.angles ?? [])
    setLoadingAngles(false)
  }

  async function fetchValueProps() {
    setLoadingValueProps(true)
    setValuePropSuggestions([])
    const res = await fetch('/api/campaigns/suggest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_name: name, target_persona: targetPersona, angle }),
    }).then(r => r.json())
    setValuePropSuggestions(res.value_props ?? [])
    setLoadingValueProps(false)
  }

  // ── Step navigation ────────────────────────────────────────────────────────
  function goToStep(n: number) {
    setError('')
    setUiStep(n)
    if (n === 1 && personaSuggestions.length === 0) fetchPersonas()
    if (n === 2 && angleSuggestions.length === 0) fetchAngles()
    if (n === 3 && valuePropSuggestions.length === 0) fetchValueProps()
  }

  // ── Generate sequence ──────────────────────────────────────────────────────
  async function handleGenerate() {
    setError('')
    setGenerating(true)
    setLoadingMsg(0)
    const finalCta = showCustomCta ? customCta : cta

    // If user goes back from Step 6 and regenerates, delete the previous draft first
    if (campaignId) {
      await fetch(`/api/campaigns/${campaignId}`, { method: 'DELETE' })
      setCampaignId(null)
      setSteps([])
    }

    const createRes = await fetch('/api/campaigns', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, target_persona: targetPersona, angle, value_prop: valueProp, cta: finalCta, smart_stop_on_reply: smartStopReply, smart_stop_on_bounce: smartStopBounce }),
    }).then(r => r.json())

    if (!createRes.campaign) {
      setError(createRes.error || 'Failed to create campaign')
      setGenerating(false)
      return
    }
    const id = createRes.campaign.id
    setCampaignId(id)

    const genRes = await fetch('/api/campaigns/generate-sequence', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: id }),
    }).then(r => r.json())

    setGenerating(false)
    if (!genRes.steps) { setError(genRes.error || 'Failed to generate sequence'); return }
    setSteps(genRes.steps)
    setUiStep(6)
  }

  async function handleSaveSequence() {
    if (!campaignId) return
    setSaving(true)
    await fetch(`/api/campaigns/${campaignId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ smart_stop_on_reply: smartStopReply, smart_stop_on_bounce: smartStopBounce }),
    })
    setSaving(false)
    window.location.href = `/dashboard/campaigns/${campaignId}`
  }

  async function updateStep(id: string, patch: Partial<Step>) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
    if (!campaignId) return
    await fetch(`/api/campaigns/${campaignId}/steps/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
  }

  async function aiWriteStep(id: string) {
    setGeneratingStep(id)
    const res = await fetch(`/api/campaigns/${campaignId}/steps/${id}/ai-write`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(r => r.json())
    if (res.step) setSteps(prev => prev.map(s => s.id === id ? { ...s, ...res.step } : s))
    setGeneratingStep(null)
  }

  async function addFollowUp() {
    const res = await fetch(`/api/campaigns/${campaignId}/steps`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(r => r.json())
    if (res.step) setSteps(prev => [...prev, res.step])
  }

  async function removeStep(id: string) {
    await fetch(`/api/campaigns/${campaignId}/steps/${id}`, { method: 'DELETE' })
    setSteps(prev => prev.filter(s => s.id !== id))
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (profileScore === null) {
    return <div className="text-sm text-[#8a7e6e] py-10 text-center">Loading…</div>
  }

  const meetingDuration: number = (profile?.booking_config as any)?.meeting_durations?.[0] ?? 30
  const CTA_OPTIONS = ctaOptions(meetingDuration)

  // ── Profile gate ───────────────────────────────────────────────────────────
  if (profileScore < 30) {
    return (
      <div className="max-w-md mx-auto mt-12 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-xl font-bold text-[#1a1a2e] mb-2">Complete your profile to create campaigns</h1>
        <p className="text-sm text-[#6b5e4e] mb-5 leading-relaxed">
          Sentra AI uses your profile to generate personalized campaigns. We need at least 30% completion to start.
        </p>
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-4 mb-5 inline-block">
          <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-2">Current AI quality score</div>
          <div className="text-3xl font-bold text-[#1a1a2e] mb-1">{profileScore}<span className="text-lg text-[#8a7e6e]">%</span></div>
          <div className="w-32 bg-[#f0ece6] rounded-full h-2 mx-auto">
            <div className="bg-red-400 h-2 rounded-full" style={{ width: `${profileScore}%` }} />
          </div>
          <div className="text-xs text-[#b0a898] mt-1.5">Need 30% to unlock campaigns</div>
        </div>
        <br />
        <Link href="/dashboard/settings"
          className="inline-block bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors">
          Complete profile →
        </Link>
      </div>
    )
  }

  // ── Step labels ────────────────────────────────────────────────────────────
  const STEPS = ['Name', 'Persona', 'Angle', 'Value Prop', 'CTA', 'Review', 'Sequence']

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <a href="/dashboard/campaigns" className="text-xs text-[#8a7e6e] hover:text-[#1a1a2e] mb-3 inline-block">← Back to campaigns</a>
        {profile && <ProfileQualityBadge profile={profile} className="mb-3" />}
        <h1 className="text-xl font-bold text-[#1a1a2e]">New Campaign</h1>
      </div>

      {/* Progress bar */}
      {uiStep < 6 && (
        <div className="flex items-center gap-1 mb-6">
          {STEPS.slice(0, 6).map((s, i) => (
            <div key={s} className="flex items-center gap-1 flex-1">
              <div className={`h-1 flex-1 rounded-full transition-colors ${i <= uiStep ? 'bg-[#3b6bef]' : 'bg-[#e8e3dc]'}`} />
            </div>
          ))}
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-lg mb-4">{error}</div>}

      {/* ── Step 0: Name ──────────────────────────────────────────────────── */}
      {uiStep === 0 && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-6 flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Campaign name *</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#3b6bef]"
              placeholder="Watch Media & Content Creators Outreach"
              onKeyDown={e => { if (e.key === 'Enter' && name.trim()) goToStep(1) }} />
          </div>
          <button onClick={() => goToStep(1)} disabled={!name.trim()}
            className="w-full bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-40">
            Next — Choose target persona →
          </button>
        </div>
      )}

      {/* ── Step 1: Persona ───────────────────────────────────────────────── */}
      {uiStep === 1 && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-6 flex flex-col gap-4">
          <div>
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-1">Step 2 of 6</div>
            <h2 className="text-base font-bold text-[#1a1a2e] mb-1">Who are you targeting?</h2>
            <p className="text-xs text-[#8a7e6e] mb-3">Select a suggestion or describe your own.</p>
            <SuggestionPills items={personaSuggestions} selected={targetPersona} onSelect={v => { setTargetPersona(v); setShowCustomPersona(false) }} loading={loadingPersonas} />
          </div>
          {!showCustomPersona ? (
            <button onClick={() => setShowCustomPersona(true)} className="text-xs text-[#3b6bef] font-medium text-left hover:underline">
              + Or describe your own persona
            </button>
          ) : (
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Custom target persona</label>
              <input value={targetPersona} onChange={e => setTargetPersona(e.target.value)}
                className="w-full border border-[#3b6bef] rounded-lg px-3 py-2.5 text-sm focus:outline-none" autoFocus
                placeholder="e.g. Heads of Marketing at indie watch brands, 10-50 employees" />
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={() => setUiStep(0)} className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2.5 text-sm">← Back</button>
            <button onClick={() => goToStep(2)} disabled={!targetPersona.trim()}
              className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-40">
              Next — Choose angle →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Angle ─────────────────────────────────────────────────── */}
      {uiStep === 2 && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-6 flex flex-col gap-4">
          <div>
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-1">Step 3 of 6</div>
            <h2 className="text-base font-bold text-[#1a1a2e] mb-1">What's your campaign angle?</h2>
            <p className="text-xs text-[#8a7e6e] mb-3">The narrative lens that makes your message resonate with <span className="font-medium text-[#4a4a5a]">{targetPersona}</span>.</p>
            <SuggestionPills items={angleSuggestions} selected={angle} onSelect={v => { setAngle(v); setShowCustomAngle(false) }} loading={loadingAngles} />
          </div>
          {!showCustomAngle ? (
            <button onClick={() => setShowCustomAngle(true)} className="text-xs text-[#3b6bef] font-medium text-left hover:underline">
              + Or write your own angle
            </button>
          ) : (
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Custom angle</label>
              <textarea value={angle} onChange={e => setAngle(e.target.value)} rows={2} autoFocus
                className="w-full border border-[#3b6bef] rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                placeholder="e.g. Position us as the tool that turns cold outreach into a systematic pipeline" />
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={() => setUiStep(1)} className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2.5 text-sm">← Back</button>
            <button onClick={() => goToStep(3)} disabled={!angle.trim()}
              className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-40">
              Next — Choose value prop →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Value prop ────────────────────────────────────────────── */}
      {uiStep === 3 && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-6 flex flex-col gap-4">
          <div>
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-1">Step 4 of 6</div>
            <h2 className="text-base font-bold text-[#1a1a2e] mb-1">What's the core value you're delivering?</h2>
            <p className="text-xs text-[#8a7e6e] mb-3">The specific benefit for <span className="font-medium text-[#4a4a5a]">{targetPersona}</span> given the angle: <span className="italic">{angle.slice(0, 60)}{angle.length > 60 ? '…' : ''}</span></p>
            <SuggestionPills items={valuePropSuggestions} selected={valueProp} onSelect={v => { setValueProp(v); setShowCustomValueProp(false) }} loading={loadingValueProps} />
          </div>
          {!showCustomValueProp ? (
            <button onClick={() => setShowCustomValueProp(true)} className="text-xs text-[#3b6bef] font-medium text-left hover:underline">
              + Or write your own value prop
            </button>
          ) : (
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Custom value proposition</label>
              <textarea value={valueProp} onChange={e => setValueProp(e.target.value)} rows={2} autoFocus
                className="w-full border border-[#3b6bef] rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                placeholder="e.g. Get featured in our weekly newsletter to 50K watch enthusiasts" />
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={() => setUiStep(2)} className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2.5 text-sm">← Back</button>
            <button onClick={() => { setError(''); setUiStep(4) }} disabled={!valueProp.trim()}
              className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-40">
              Next — Choose CTA →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: CTA ───────────────────────────────────────────────────── */}
      {uiStep === 4 && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-6 flex flex-col gap-4">
          <div>
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-1">Step 5 of 6</div>
            <h2 className="text-base font-bold text-[#1a1a2e] mb-1">What action do you want prospects to take?</h2>
            <p className="text-xs text-[#8a7e6e] mb-3">Choose one or write your own.</p>
            <div className="flex flex-col gap-2">
              {CTA_OPTIONS.map((option, i) => (
                <button key={i} type="button" onClick={() => { setCta(option); setShowCustomCta(false) }}
                  className={`text-left px-3 py-2.5 rounded-xl text-sm border transition-colors ${!showCustomCta && cta === option ? 'border-[#3b6bef] bg-[#eef1fd] text-[#1a1a2e] font-medium' : 'border-[#e8e3dc] bg-white text-[#4a4a5a] hover:border-[#c8d4e8]'}`}>
                  <span className={`font-bold mr-1.5 ${!showCustomCta && cta === option ? 'text-[#3b6bef]' : 'text-[#b0a898]'}`}>{!showCustomCta && cta === option ? '✓' : `${i + 1}.`}</span>{option}
                </button>
              ))}
            </div>
          </div>
          {!showCustomCta ? (
            <button onClick={() => { setShowCustomCta(true); setCta('') }} className="text-xs text-[#3b6bef] font-medium text-left hover:underline">
              + Or write your own CTA
            </button>
          ) : (
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Custom CTA</label>
              <input value={customCta} onChange={e => setCustomCta(e.target.value)} autoFocus
                className="w-full border border-[#3b6bef] rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                placeholder="e.g. Let's hop on a quick 10-min call" />
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={() => setUiStep(3)} className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2.5 text-sm">← Back</button>
            <button onClick={() => { setError(''); setUiStep(5) }}
              disabled={showCustomCta ? !customCta.trim() : !cta.trim()}
              className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-40">
              Next — Review →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 5: Review ────────────────────────────────────────────────── */}
      {uiStep === 5 && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-6 flex flex-col gap-5">
          <div>
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-1">Step 6 of 6</div>
            <h2 className="text-base font-bold text-[#1a1a2e] mb-3">Review your campaign brief</h2>
            <div className="flex flex-col gap-3 text-sm">
              {[
                { label: 'Campaign name', value: name, step: 0 },
                { label: 'Target persona', value: targetPersona, step: 1 },
                { label: 'Angle', value: angle, step: 2 },
                { label: 'Value proposition', value: valueProp, step: 3 },
                { label: 'CTA', value: showCustomCta ? customCta : cta, step: 4 },
              ].map(f => (
                <div key={f.label} className="flex items-start justify-between gap-4 py-2.5 border-b border-[#f5f2ee] last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-[#8a7e6e] mb-0.5">{f.label}</div>
                    <div className="text-[#1a1a2e] leading-snug">{f.value}</div>
                  </div>
                  <button onClick={() => setUiStep(f.step)} className="text-xs text-[#3b6bef] font-medium flex-shrink-0 hover:underline">Edit</button>
                </div>
              ))}
            </div>
          </div>

          {/* Smart Stop */}
          <div className="border border-[#e8e3dc] rounded-xl p-3">
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-2">Smart Stop Conditions</div>
            <div className="flex flex-col gap-2">
              <Toggle label="Stop sequence when prospect replies" checked={smartStopReply} onChange={setSmartStopReply} />
              <Toggle label="Stop sequence on hard bounce" checked={smartStopBounce} onChange={setSmartStopBounce} />
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setUiStep(4)} className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2.5 text-sm">← Back</button>
            <button onClick={handleGenerate} disabled={generating}
              className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-3 text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2">
              {generating
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{LOADING_MESSAGES[loadingMsg]}</>
                : '✦ Generate sequence with AI →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 6: Sequence preview ──────────────────────────────────────── */}
      {uiStep === 6 && (
        <div className="flex flex-col gap-4">
          <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-xl px-4 py-2.5 text-sm text-[#3b6bef] font-medium flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
            draft · {name} · {steps.length} emails ready
          </div>

          {steps.map((step, idx) => (
            <StepCard key={step.id} step={step} index={idx} isOnly={steps.length <= 1}
              saving={generatingStep === step.id}
              onUpdate={patch => updateStep(step.id, patch)}
              onAiWrite={() => aiWriteStep(step.id)}
              onRemove={() => removeStep(step.id)}
            />
          ))}

          <button onClick={addFollowUp}
            className="w-full border border-dashed border-[#c8d4e8] text-[#3b6bef] text-sm py-3 rounded-xl hover:bg-[#f7f8ff] transition-colors font-medium">
            + Add follow-up step
          </button>

          <div className="bg-white border border-[#e8e3dc] rounded-xl p-4">
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-3">Smart Stop Conditions</div>
            <div className="flex flex-col gap-2">
              <Toggle label="Stop sequence when prospect replies" checked={smartStopReply} onChange={setSmartStopReply} />
              <Toggle label="Stop sequence on hard bounce" checked={smartStopBounce} onChange={setSmartStopBounce} />
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setUiStep(5)} className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2.5 text-sm">← Back</button>
            <button disabled className="border border-[#e8e3dc] text-[#b0a898] rounded-lg px-4 py-2.5 text-sm cursor-not-allowed" title="Sprint 17">
              Save as Template
            </button>
            <button onClick={handleSaveSequence} disabled={saving}
              className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-40">
              {saving ? 'Saving…' : 'Save Sequence →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepCard({ step, index, isOnly, saving, onUpdate, onAiWrite, onRemove }: {
  step: Step; index: number; isOnly: boolean; saving: boolean
  onUpdate: (p: Partial<Step>) => void; onAiWrite: () => void; onRemove: () => void
}) {
  const isInitial = step.step_type === 'initial'
  return (
    <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-[#1a1a2e] text-white text-xs flex items-center justify-center font-bold flex-shrink-0">{index + 1}</div>
          <span className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">{isInitial ? 'Initial email' : `Follow-up ${index}`}</span>
          {!isInitial && <span className="text-xs text-[#b0a898]">· Day +{step.delay_days}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onAiWrite} disabled={saving}
            title="Regenerate this email with AI"
            className="text-xs text-[#3b6bef] font-semibold border border-[#dde6fd] bg-[#f7f8ff] px-2.5 py-1 rounded-lg hover:bg-[#eef1fd] disabled:opacity-40 flex items-center gap-1.5">
            {saving ? <span className="w-3 h-3 border border-[#3b6bef]/30 border-t-[#3b6bef] rounded-full animate-spin" /> : '✨'} Regenerate
          </button>
          {!isInitial && !isOnly && (
            <button onClick={onRemove} className="text-xs text-red-400 hover:text-red-600 font-medium">Remove</button>
          )}
        </div>
      </div>
      {!isInitial && (
        <div className="mb-3">
          <label className="text-xs font-medium text-[#6b5e4e] mb-1 block">Send after (days from previous step)</label>
          <input type="number" min={1} max={60} value={step.delay_days}
            onChange={e => onUpdate({ delay_days: parseInt(e.target.value) || 1 })}
            className="w-24 border border-[#e8e3dc] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#3b6bef]" />
        </div>
      )}
      <div className="mb-3">
        <label className="text-xs font-medium text-[#6b5e4e] mb-1 block">
          Subject line{!isInitial ? ' (leave blank to thread reply)' : ' *'}
        </label>
        <input value={step.subject ?? ''} onChange={e => onUpdate({ subject: e.target.value || null })}
          className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
          placeholder={isInitial ? 'Subject line…' : 'Leave blank to thread on previous email'} />
      </div>
      <div className="mb-3">
        <label className="text-xs font-medium text-[#6b5e4e] mb-1 block">Email body</label>
        <textarea value={step.body} onChange={e => onUpdate({ body: e.target.value })}
          className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none font-mono text-xs leading-relaxed"
          rows={7} />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={step.include_booking_link}
          onChange={e => onUpdate({ include_booking_link: e.target.checked })}
          className="rounded border-[#e8e3dc] text-[#3b6bef]" />
        <span className="text-xs text-[#6b5e4e]">Include calendar booking link in this email</span>
      </label>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[#4a4a5a]">{label}</span>
      <button type="button" onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-[#3b6bef]' : 'bg-[#e8e3dc]'}`}>
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )
}
