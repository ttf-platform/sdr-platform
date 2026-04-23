'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function NewCampaignPage() {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string|null>(null)
  const [profile, setProfile] = useState<any>(null)
  const [campaign, setCampaign] = useState({ name: '', icp: '', tone: 'professional', product: '' })
  const [sequence, setSequence] = useState<any[]>([])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: member } = await supabase.from('workspace_members').select('workspace_id').eq('user_id', session.user.id).single()
      if (member) {
        setWorkspaceId(member.workspace_id)
        const { data: p } = await supabase.from('workspace_profiles').select('*').eq('workspace_id', member.workspace_id).single()
        setProfile(p)
        setCampaign({
          name: params.get('name') || '',
          icp: params.get('icp') || p?.icp_description || '',
          tone: params.get('tone') || p?.tone || 'professional',
          product: p?.product_description || ''
        })
      }
    })
  }, [])

  async function generateSequence() {
    setGenerating(true)
    const res = await fetch('/api/campaigns/generate-sequence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign, profile })
    }).then(r => r.json())
    setSequence(res.sequence || [])
    setGenerating(false)
    setStep(1)
  }

  async function saveCampaign() {
    setLoading(true)
    const { data: camp } = await supabase.from('campaigns').insert({
      workspace_id: workspaceId,
      name: campaign.name,
      status: 'draft',
      icp_snapshot: { icp: campaign.icp, tone: campaign.tone }
    }).select().single()
    if (camp && sequence.length > 0) {
      await supabase.from('campaign_steps').insert(
        sequence.map((s, i) => ({ campaign_id: camp.id, step_number: i+1, subject: s.subject, body: s.body, delay_days: i === 0 ? 0 : 3 }))
      )
    }
    window.location.href = '/dashboard/campaigns'
  }

  const tones = ['professional', 'friendly', 'direct', 'casual']

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <a href="/dashboard/campaigns" className="text-xs text-[#8a7e6e] hover:text-[#1a1a2e] mb-3 inline-block">← Back to campaigns</a>
        <h1 className="text-xl font-bold text-[#1a1a2e]">New Campaign</h1>
      </div>

      <div className="flex gap-2 mb-6">
        {['Setup', 'Sequence'].map((s, i) => (
          <div key={s} className={"px-4 py-2 rounded-lg text-sm font-medium " + (step === i ? 'bg-[#1a1a2e] text-white' : 'bg-white border border-[#e8e3dc] text-[#8a7e6e]')}>{i+1}. {s}</div>
        ))}
      </div>

      {step === 0 && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-6 flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium text-[#6b5e4e] mb-1 block">Campaign name</label>
            <input value={campaign.name} onChange={e=>setCampaign({...campaign,name:e.target.value})}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
              placeholder="VP Sales EMEA — Q2" />
          </div>
          <div>
            <label className="text-xs font-medium text-[#6b5e4e] mb-1 block">Target ICP</label>
            <textarea value={campaign.icp} onChange={e=>setCampaign({...campaign,icp:e.target.value})}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none"
              rows={3} placeholder="Describe your target..." />
          </div>
          <div>
            <label className="text-xs font-medium text-[#6b5e4e] mb-2 block">Tone</label>
            <div className="grid grid-cols-4 gap-2">
              {tones.map(t => (
                <button key={t} onClick={()=>setCampaign({...campaign,tone:t})}
                  className={"px-3 py-2 rounded-lg text-sm border capitalize " + (campaign.tone===t ? 'bg-[#1a1a2e] text-white border-[#1a1a2e]' : 'border-[#e8e3dc] text-[#6b5e4e]')}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <button onClick={generateSequence} disabled={!campaign.name||!campaign.icp||generating}
            className="w-full bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2">
            {generating ? 'Claude is writing your sequence...' : '✦ Generate 5-email sequence with AI'}
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-xl p-4 text-sm text-[#3b6bef]">
            ✦ Claude wrote {sequence.length} emails for <strong>{campaign.name}</strong>. Review and edit before saving.
          </div>
          {sequence.map((email, i) => (
            <div key={i} className="bg-white border border-[#e8e3dc] rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[#8a7e6e]">Email {i+1} {i === 0 ? '· Day 0' : '· Day +'+(i*3)}</span>
              </div>
              <input value={email.subject} onChange={e=>{const s=[...sequence];s[i]={...s[i],subject:e.target.value};setSequence(s)}}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] mb-3 font-medium"
                placeholder="Subject line" />
              <textarea value={email.body} onChange={e=>{const s=[...sequence];s[i]={...s[i],body:e.target.value};setSequence(s)}}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none"
                rows={6} />
            </div>
          ))}
          <div className="flex gap-3">
            <button onClick={()=>setStep(0)} className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2.5 text-sm">← Back</button>
            <button onClick={generateSequence} disabled={generating} className="border border-[#3b6bef] text-[#3b6bef] px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40">
              {generating ? 'Regenerating...' : '↺ Regenerate'}
            </button>
            <button onClick={saveCampaign} disabled={loading} className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40">
              {loading ? 'Saving...' : 'Save Campaign →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}