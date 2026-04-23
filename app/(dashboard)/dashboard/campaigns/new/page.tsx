'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function NewCampaignPage() {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [parsingIcp, setParsingIcp] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string|null>(null)
  const [profile, setProfile] = useState<any>(null)
  const [campaign, setCampaign] = useState({ name: '', icp: '', tone: 'professional', product: '' })
  const [parsedIcp, setParsedIcp] = useState<any>(null)
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

  async function parseIcp() {
    if (!campaign.icp) return
    setParsingIcp(true)
    setParsedIcp(null)
    const res = await fetch('/api/icp/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: campaign.icp })
    }).then(r => r.json())
    if (res.icp) setParsedIcp(res.icp)
    setParsingIcp(false)
  }

  async function generateSequence() {
    setGenerating(true)
    const enrichedCampaign = { ...campaign, parsedIcp }
    const res = await fetch('/api/campaigns/generate-sequence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign: enrichedCampaign, profile })
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
      icp_snapshot: { icp: campaign.icp, tone: campaign.tone, parsed: parsedIcp }
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
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-[#1a1a2e]">New Campaign</h1>
          <a href="/dashboard/campaigns/suggestions" className="border border-[#e8e3dc] bg-white text-[#1a1a2e] px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-[#f0ece6] flex items-center gap-1.5">✦ AI Suggestions</a>
        </div>
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
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[#6b5e4e]">Target ICP</label>
              <button onClick={parseIcp} disabled={parsingIcp || !campaign.icp}
                className="text-xs text-[#3b6bef] font-medium hover:underline disabled:opacity-40">
                {parsingIcp ? 'Parsing...' : '✦ Parse with AI'}
              </button>
            </div>
            <textarea value={campaign.icp} onChange={e=>{setCampaign({...campaign,icp:e.target.value});setParsedIcp(null)}}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none"
              rows={3} placeholder="Describe your target in plain language — e.g. VP Sales at B2B SaaS companies, 50-500 employees, Series A to C..." />
            <p className="text-xs text-[#b0a898] mt-1">Type naturally, then click Parse with AI to structure it.</p>
          </div>

          {parsedIcp && (
            <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-xl p-4 flex flex-col gap-3">
              <div className="text-xs font-bold uppercase tracking-wider text-[#3b6bef]">✦ Parsed ICP</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium text-[#6b5e4e] mb-1">Industries</div>
                  <div className="flex flex-wrap gap-1">
                    {parsedIcp.industries?.map((ind: string) => (
                      <span key={ind} className="text-xs bg-white border border-[#dde6fd] text-[#3b6bef] px-2 py-0.5 rounded-full">{ind}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-[#6b5e4e] mb-1">Target titles</div>
                  <div className="flex flex-wrap gap-1">
                    {parsedIcp.titles?.map((t: string) => (
                      <span key={t} className="text-xs bg-white border border-[#dde6fd] text-[#3b6bef] px-2 py-0.5 rounded-full">{t}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-[#6b5e4e] mb-1">Company size</div>
                  <span className="text-xs text-[#4a3f32]">{parsedIcp.company_size || '—'}</span>
                </div>
                <div>
                  <div className="text-xs font-medium text-[#6b5e4e] mb-1">Regions</div>
                  <span className="text-xs text-[#4a3f32]">{parsedIcp.regions?.join(', ') || '—'}</span>
                </div>
                <div>
                  <div className="text-xs font-medium text-[#6b5e4e] mb-1">Revenue range</div>
                  <span className="text-xs text-[#4a3f32]">{parsedIcp.revenue || '—'}</span>
                </div>
                <div>
                  <div className="text-xs font-medium text-[#6b5e4e] mb-1">Pain points</div>
                  <span className="text-xs text-[#4a3f32]">{parsedIcp.pain_points?.join(', ') || '—'}</span>
                </div>
              </div>
            </div>
          )}

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
              <span className="text-xs font-bold uppercase tracking-wider text-[#8a7e6e] block mb-3">Email {i+1} {i === 0 ? '· Day 0' : '· Day +'+(i*3)}</span>
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