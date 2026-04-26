'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ProfileQualityBadge from '@/components/ProfileQualityBadge'

const supabase = createClient()

const LOADING_MESSAGES = [
  'Analyzing your value prop…',
  'Crafting subject lines…',
  'Writing follow-ups…',
  'Applying your tone…',
]

interface Step {
  id: string
  step_order: number
  step_type: 'initial' | 'follow_up'
  delay_days: number
  subject: string | null
  body: string
  include_booking_link: boolean
}

export default function NewCampaignPage() {
  const [uiStep, setUiStep] = useState(0)
  const [profile, setProfile] = useState<any>(null)
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatingStep, setGeneratingStep] = useState<string | null>(null)
  const [loadingMsg, setLoadingMsg] = useState(0)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '', target_persona: '', angle: '', value_prop: '', cta: '',
    smart_stop_on_reply: true, smart_stop_on_bounce: true,
  })

  const loadingInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      const { data: member } = await supabase.from('workspace_members').select('workspace_id').eq('user_id', session.user.id).single()
      if (!member) return
      const { data: p } = await supabase.from('workspace_profiles').select('*').eq('workspace_id', member.workspace_id).single()
      setProfile(p)
      setForm(f => ({
        ...f,
        name: params.get('name') || '',
        target_persona: params.get('icp') || p?.icp_description || '',
        value_prop: params.get('hook') || '',
      }))
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

  async function handleGenerate() {
    setError('')
    setGenerating(true)
    setLoadingMsg(0)

    // 1. Create campaign
    const createRes = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).then(r => r.json())

    if (!createRes.campaign) {
      setError(createRes.error || 'Failed to create campaign')
      setGenerating(false)
      return
    }

    const id = createRes.campaign.id
    setCampaignId(id)

    // 2. Generate sequence
    const genRes = await fetch('/api/campaigns/generate-sequence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: id }),
    }).then(r => r.json())

    setGenerating(false)

    if (!genRes.steps) {
      setError(genRes.error || 'Failed to generate sequence')
      return
    }

    setSteps(genRes.steps)
    setUiStep(1)
  }

  async function handleSaveSequence() {
    if (!campaignId) return
    setSaving(true)
    // Persist smart-stop settings
    await fetch(`/api/campaigns/${campaignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ smart_stop_on_reply: form.smart_stop_on_reply, smart_stop_on_bounce: form.smart_stop_on_bounce }),
    })
    setSaving(false)
    window.location.href = `/dashboard/campaigns/${campaignId}`
  }

  async function updateStep(id: string, patch: Partial<Step>) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
    await fetch(`/api/campaigns/${campaignId}/steps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  }

  async function aiWriteStep(id: string) {
    setGeneratingStep(id)
    const res = await fetch(`/api/campaigns/${campaignId}/steps/${id}/ai-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
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

  const canGenerate = form.name.trim() && form.target_persona.trim() && form.angle.trim() && form.value_prop.trim() && form.cta.trim()

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <a href="/dashboard/campaigns" className="text-xs text-[#8a7e6e] hover:text-[#1a1a2e] mb-3 inline-block">← Back to campaigns</a>
        {profile && <ProfileQualityBadge profile={profile} className="mb-3" />}
        <h1 className="text-xl font-bold text-[#1a1a2e]">New Campaign</h1>
      </div>

      {/* Step tabs */}
      <div className="flex gap-2 mb-6">
        {['Setup', 'Sequence'].map((s, i) => (
          <div key={s} className={`px-4 py-2 rounded-lg text-sm font-medium ${uiStep === i ? 'bg-[#1a1a2e] text-white' : 'bg-white border border-[#e8e3dc] text-[#8a7e6e]'}`}>{i + 1}. {s}</div>
        ))}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-lg mb-4">{error}</div>}

      {/* ── Step 1: Setup ─────────────────────────────────────────────────────── */}
      {uiStep === 0 && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-6 flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Campaign name *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
              placeholder="Watch Media & Content Creators Outreach" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Target persona *</label>
            <input value={form.target_persona} onChange={e => setForm({ ...form, target_persona: e.target.value })}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
              placeholder="Heads of Marketing at indie watch brands, 10-50 employees" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Campaign angle *</label>
            <textarea value={form.angle} onChange={e => setForm({ ...form, angle: e.target.value })}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" rows={2}
              placeholder="Position us as the curator that puts indie brands in front of engaged enthusiasts" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Value proposition *</label>
            <textarea value={form.value_prop} onChange={e => setForm({ ...form, value_prop: e.target.value })}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" rows={2}
              placeholder="Get featured in our weekly newsletter to 50K watch enthusiasts" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Desired CTA *</label>
            <input value={form.cta} onChange={e => setForm({ ...form, cta: e.target.value })}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
              placeholder="Book a 30-min discovery call" />
          </div>

          <button onClick={handleGenerate} disabled={!canGenerate || generating}
            className="w-full bg-[#1a1a2e] text-white rounded-lg py-3 text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2">
            {generating ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {LOADING_MESSAGES[loadingMsg]}
              </>
            ) : '✦ Generate sequence with AI →'}
          </button>
        </div>
      )}

      {/* ── Step 2: Sequence preview ──────────────────────────────────────────── */}
      {uiStep === 1 && (
        <div className="flex flex-col gap-4">
          {/* Status line */}
          <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-xl px-4 py-2.5 text-sm text-[#3b6bef] font-medium flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
            draft · {form.name} · {steps.length} emails ready
          </div>

          {/* Step cards */}
          {steps.map((step, idx) => (
            <StepCard
              key={step.id}
              step={step}
              index={idx}
              isOnly={steps.length <= 1}
              saving={generatingStep === step.id}
              onUpdate={patch => updateStep(step.id, patch)}
              onAiWrite={() => aiWriteStep(step.id)}
              onRemove={() => removeStep(step.id)}
            />
          ))}

          {/* Add follow-up */}
          <button onClick={addFollowUp}
            className="w-full border border-dashed border-[#c8d4e8] text-[#3b6bef] text-sm py-3 rounded-xl hover:bg-[#f7f8ff] transition-colors font-medium">
            + Add follow-up step
          </button>

          {/* Smart Stop */}
          <div className="bg-white border border-[#e8e3dc] rounded-xl p-4">
            <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-3">Smart Stop Conditions</div>
            <div className="flex flex-col gap-2">
              <Toggle label="Stop sequence when prospect replies" checked={form.smart_stop_on_reply} onChange={v => setForm(f => ({ ...f, smart_stop_on_reply: v }))} />
              <Toggle label="Stop sequence on hard bounce" checked={form.smart_stop_on_bounce} onChange={v => setForm(f => ({ ...f, smart_stop_on_bounce: v }))} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button onClick={() => setUiStep(0)} className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2.5 text-sm">← Back</button>
            <button disabled className="border border-[#e8e3dc] text-[#b0a898] rounded-lg px-4 py-2.5 text-sm cursor-not-allowed" title="Sprint 17">Save as Template</button>
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
  const label = isInitial ? 'Initial email' : `Follow-up ${index}`

  return (
    <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-[#1a1a2e] text-white text-xs flex items-center justify-center font-bold flex-shrink-0">{index + 1}</div>
          <span className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">{label}</span>
          {!isInitial && (
            <span className="text-xs text-[#b0a898]">· Day +{step.delay_days}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onAiWrite} disabled={saving}
            className="text-xs text-[#3b6bef] font-medium border border-[#dde6fd] bg-[#f7f8ff] px-2.5 py-1 rounded-lg hover:bg-[#eef1fd] disabled:opacity-40 flex items-center gap-1">
            {saving ? <><span className="w-3 h-3 border border-[#3b6bef]/30 border-t-[#3b6bef] rounded-full animate-spin" /></> : '✦'} AI Write
          </button>
          {!isInitial && !isOnly && (
            <button onClick={onRemove} className="text-xs text-red-400 hover:text-red-600 font-medium">Remove</button>
          )}
        </div>
      </div>

      {/* Delay days for follow-ups */}
      {!isInitial && (
        <div className="mb-3">
          <label className="text-xs font-medium text-[#6b5e4e] mb-1 block">Send after (days from previous step)</label>
          <input type="number" min={1} max={60} value={step.delay_days}
            onChange={e => onUpdate({ delay_days: parseInt(e.target.value) || 1 })}
            className="w-24 border border-[#e8e3dc] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#3b6bef]" />
        </div>
      )}

      {/* Subject */}
      <div className="mb-3">
        <label className="text-xs font-medium text-[#6b5e4e] mb-1 block">
          Subject line{!isInitial ? ' (leave blank to thread reply)' : ' *'}
        </label>
        <input value={step.subject ?? ''}
          onChange={e => onUpdate({ subject: e.target.value || null })}
          className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
          placeholder={isInitial ? 'Subject line…' : 'Leave blank to thread on previous email'} />
      </div>

      {/* Body */}
      <div className="mb-3">
        <label className="text-xs font-medium text-[#6b5e4e] mb-1 block">Email body</label>
        <textarea value={step.body}
          onChange={e => onUpdate({ body: e.target.value })}
          className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none font-mono text-xs leading-relaxed"
          rows={7} />
      </div>

      {/* Booking link */}
      {!isInitial && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={step.include_booking_link}
            onChange={e => onUpdate({ include_booking_link: e.target.checked })}
            className="rounded border-[#e8e3dc] text-[#3b6bef]" />
          <span className="text-xs text-[#6b5e4e]">Include calendar booking link in this email</span>
        </label>
      )}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[#4a4a5a]">{label}</span>
      <button onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-[#3b6bef]' : 'bg-[#e8e3dc]'}`}>
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )
}
