'use client'
import { useEffect, useRef, useState } from 'react'

interface Step {
  id: string; step_order: number; step_type: 'initial' | 'follow_up'
  delay_days: number; subject: string | null; body: string; include_booking_link: boolean
}
interface Campaign {
  id: string; name: string; status: string; target_persona: string | null
  angle: string | null; value_prop: string | null; cta: string | null
  prospects_count: number; sent_count: number; opened_count: number
  replied_count: number; meeting_count: number
  smart_stop_on_reply: boolean; smart_stop_on_bounce: boolean
}

const LOADING_MESSAGES = ['Analyzing your value prop…', 'Crafting subject lines…', 'Writing follow-ups…', 'Applying your tone…']

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-[#f0ece6] text-[#6b5e4e]',
  active: 'bg-green-50 text-green-700',
  paused: 'bg-amber-50 text-amber-700',
  completed: 'bg-blue-50 text-blue-700',
  archived: 'bg-gray-100 text-gray-500',
}

export default function CampaignDetailPage({ params }: { params: { id: string } }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [tab, setTab] = useState<'overview' | 'prospects' | 'emails' | 'sequence'>('overview')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [generatingStep, setGeneratingStep] = useState<string | null>(null)
  const [loadingMsg, setLoadingMsg] = useState(0)
  const [saving, setSaving] = useState(false)
  const [stopSettings, setStopSettings] = useState({ smart_stop_on_reply: true, smart_stop_on_bounce: true })
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Campaign>>({})
  const [error, setError] = useState('')
  const loadingInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetch(`/api/campaigns/${params.id}`)
      .then(r => r.json())
      .then(({ campaign: c, steps: s }) => {
        if (c) {
          setCampaign(c)
          setStopSettings({ smart_stop_on_reply: c.smart_stop_on_reply, smart_stop_on_bounce: c.smart_stop_on_bounce })
        }
        setSteps(s ?? [])
        setLoading(false)
      })
  }, [params.id])

  useEffect(() => {
    if (generating) {
      loadingInterval.current = setInterval(() => setLoadingMsg(i => (i + 1) % LOADING_MESSAGES.length), 3000)
    } else {
      if (loadingInterval.current) clearInterval(loadingInterval.current)
    }
    return () => { if (loadingInterval.current) clearInterval(loadingInterval.current) }
  }, [generating])

  async function generateSequence() {
    setError('')
    setGenerating(true)
    setLoadingMsg(0)
    const res = await fetch('/api/campaigns/generate-sequence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: params.id, overwrite: steps.length > 0 }),
    }).then(r => r.json())
    setGenerating(false)
    if (res.steps) setSteps(res.steps)
    else setError(res.error || 'Failed to generate sequence')
  }

  async function updateStep(id: string, patch: Partial<Step>) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
    await fetch(`/api/campaigns/${params.id}/steps/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
  }

  async function aiWriteStep(id: string) {
    setGeneratingStep(id)
    const res = await fetch(`/api/campaigns/${params.id}/steps/${id}/ai-write`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(r => r.json())
    if (res.step) setSteps(prev => prev.map(s => s.id === id ? { ...s, ...res.step } : s))
    setGeneratingStep(null)
  }

  async function addFollowUp() {
    const res = await fetch(`/api/campaigns/${params.id}/steps`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(r => r.json())
    if (res.step) setSteps(prev => [...prev, res.step])
  }

  async function removeStep(id: string) {
    await fetch(`/api/campaigns/${params.id}/steps/${id}`, { method: 'DELETE' })
    setSteps(prev => prev.filter(s => s.id !== id))
  }

  async function saveSequence() {
    setSaving(true)
    await fetch(`/api/campaigns/${params.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stopSettings),
    })
    setSaving(false)
  }

  async function saveCampaignEdit() {
    setSaving(true)
    const res = await fetch(`/api/campaigns/${params.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm),
    }).then(r => r.json())
    if (res.campaign) setCampaign(res.campaign)
    setEditMode(false)
    setSaving(false)
  }

  if (loading) return <div className="text-sm text-[#8a7e6e] py-10 text-center">Loading…</div>
  if (!campaign) return <div className="text-sm text-red-500 py-10 text-center">Campaign not found.</div>

  const statusLabel = campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <a href="/dashboard/campaigns" className="text-xs text-[#8a7e6e] hover:text-[#1a1a2e] mb-2 inline-block">← Back to campaigns</a>
          <h1 className="text-2xl font-bold text-[#1a1a2e] leading-tight">{campaign.name}</h1>
          <p className="text-sm text-[#8a7e6e] mt-0.5">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold mr-2 ${STATUS_COLORS[campaign.status] ?? 'bg-gray-100 text-gray-500'}`}>{statusLabel}</span>
            {campaign.prospects_count} prospects · {campaign.sent_count} sent
          </p>
        </div>
        <a href="/dashboard/campaigns" className="border border-[#e8e3dc] bg-white text-[#6b5e4e] px-3 py-2 rounded-lg text-sm font-medium hover:bg-[#f5f2ee]">← Back</a>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-lg mt-3 mb-2">{error}</div>}

      {/* Tabs */}
      <div className="flex gap-1 my-5 p-1 bg-[#f0ece6] rounded-xl w-fit">
        {([
          { key: 'overview',  label: 'Overview' },
          { key: 'prospects', label: `Prospects (${campaign.prospects_count})` },
          { key: 'emails',    label: 'Emails (0)' },
          { key: 'sequence',  label: 'Follow-up Sequence' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${tab === t.key ? 'bg-white shadow-sm text-[#1a1a2e]' : 'text-[#8a7e6e] hover:text-[#4a4a5a]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Overview ────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: 'Prospects', value: campaign.prospects_count },
              { label: 'Sent',      value: campaign.sent_count },
              { label: 'Opened',    value: campaign.opened_count },
              { label: 'Replied',   value: campaign.replied_count },
              { label: 'Meetings',  value: campaign.meeting_count },
            ].map(s => (
              <div key={s.label} className="bg-white border border-[#e8e3dc] rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-[#1a1a2e]">{s.value}</div>
                <div className="text-xs text-[#8a7e6e] uppercase tracking-wider mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Campaign info */}
          {!editMode ? (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider">Campaign Info</div>
                <button onClick={() => { setEditForm({ name: campaign.name, target_persona: campaign.target_persona ?? '', angle: campaign.angle ?? '', value_prop: campaign.value_prop ?? '', cta: campaign.cta ?? '' }); setEditMode(true) }}
                  className="text-xs text-[#3b6bef] font-medium hover:underline">Edit campaign</button>
              </div>
              <div className="flex flex-col gap-3 text-sm">
                {[
                  { label: 'Target persona', value: campaign.target_persona },
                  { label: 'Angle', value: campaign.angle },
                  { label: 'Value proposition', value: campaign.value_prop },
                  { label: 'CTA', value: campaign.cta },
                ].map(f => f.value && (
                  <div key={f.label}>
                    <div className="text-xs font-semibold text-[#6b5e4e] mb-0.5">{f.label}</div>
                    <div className="text-[#4a4a5a] leading-relaxed">{f.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 flex flex-col gap-3">
              <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-1">Edit Campaign</div>
              {[
                { key: 'name', label: 'Name', rows: 1 },
                { key: 'target_persona', label: 'Target persona', rows: 2 },
                { key: 'angle', label: 'Angle', rows: 2 },
                { key: 'value_prop', label: 'Value proposition', rows: 2 },
                { key: 'cta', label: 'CTA', rows: 1 },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">{f.label}</label>
                  {f.rows === 1
                    ? <input value={(editForm as any)[f.key] ?? ''} onChange={e => setEditForm({ ...editForm, [f.key]: e.target.value })} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
                    : <textarea value={(editForm as any)[f.key] ?? ''} onChange={e => setEditForm({ ...editForm, [f.key]: e.target.value })} rows={f.rows} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" />
                  }
                </div>
              ))}
              <div className="flex gap-2 mt-1">
                <button onClick={() => setEditMode(false)} className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm">Cancel</button>
                <button onClick={saveCampaignEdit} disabled={saving} className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Prospects ───────────────────────────────────────────────────── */}
      {tab === 'prospects' && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-10 text-center">
          <div className="text-3xl mb-3">📋</div>
          <h2 className="text-base font-bold text-[#1a1a2e] mb-2">Prospect import coming in Sprint 16b</h2>
          <p className="text-sm text-[#8a7e6e]">You'll be able to import via CSV, paste a list, or add manually.</p>
        </div>
      )}

      {/* ── Tab: Emails ──────────────────────────────────────────────────────── */}
      {tab === 'emails' && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-10 text-center">
          <div className="text-3xl mb-3">✉️</div>
          <h2 className="text-base font-bold text-[#1a1a2e] mb-2">Email approval queue coming in Sprint 16c</h2>
          <p className="text-sm text-[#8a7e6e]">Review and approve AI-generated emails before they send.</p>
        </div>
      )}

      {/* ── Tab: Follow-up Sequence ──────────────────────────────────────────── */}
      {tab === 'sequence' && (
        <div className="flex flex-col gap-4">
          {steps.length === 0 ? (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-10 text-center">
              <div className="text-3xl mb-3">✦</div>
              <h2 className="text-base font-bold text-[#1a1a2e] mb-2">No sequence yet</h2>
              <p className="text-sm text-[#8a7e6e] mb-4">Generate a 4-email sequence with AI in seconds.</p>
              <button onClick={generateSequence} disabled={generating}
                className="bg-[#1a1a2e] text-white px-6 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40 inline-flex items-center gap-2">
                {generating
                  ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{LOADING_MESSAGES[loadingMsg]}</>
                  : '✦ Generate sequence with AI'}
              </button>
            </div>
          ) : (
            <>
              {/* Status line */}
              <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-xl px-4 py-2.5 text-sm text-[#3b6bef] font-medium flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full inline-block ${campaign.status === 'active' ? 'bg-green-400' : 'bg-amber-400'}`} />
                  {campaign.status} · {steps.length} emails
                </span>
                <button onClick={generateSequence} disabled={generating}
                  className="text-xs text-[#3b6bef] border border-[#dde6fd] bg-white px-2.5 py-1 rounded-lg hover:bg-[#eef1fd] disabled:opacity-40 flex items-center gap-1">
                  {generating
                    ? <><span className="w-3 h-3 border border-[#3b6bef]/30 border-t-[#3b6bef] rounded-full animate-spin" />{LOADING_MESSAGES[loadingMsg]}</>
                    : '↺ Regenerate'}
                </button>
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

              {/* Smart Stop */}
              <div className="bg-white border border-[#e8e3dc] rounded-xl p-4">
                <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-3">Smart Stop Conditions</div>
                <div className="flex flex-col gap-2">
                  <Toggle label="Stop sequence when prospect replies" checked={stopSettings.smart_stop_on_reply}
                    onChange={v => setStopSettings(s => ({ ...s, smart_stop_on_reply: v }))} />
                  <Toggle label="Stop sequence on hard bounce" checked={stopSettings.smart_stop_on_bounce}
                    onChange={v => setStopSettings(s => ({ ...s, smart_stop_on_bounce: v }))} />
                </div>
              </div>

              <div className="flex gap-3">
                <button disabled className="border border-[#e8e3dc] text-[#b0a898] rounded-lg px-4 py-2.5 text-sm cursor-not-allowed" title="Sprint 17">Save as Template</button>
                <button onClick={saveSequence} disabled={saving}
                  className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-40">
                  {saving ? 'Saving…' : 'Save Sequence'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

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
            className="text-xs text-[#3b6bef] font-medium border border-[#dde6fd] bg-[#f7f8ff] px-2.5 py-1 rounded-lg hover:bg-[#eef1fd] disabled:opacity-40 flex items-center gap-1">
            {saving ? <span className="w-3 h-3 border border-[#3b6bef]/30 border-t-[#3b6bef] rounded-full animate-spin" /> : '✦'} AI Write
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
