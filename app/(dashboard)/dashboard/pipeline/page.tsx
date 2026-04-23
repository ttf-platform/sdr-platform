'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

const STAGES = ['new_lead','contacted','opened','replied','interested','meeting_booked','proposal_sent','closed_won','closed_lost']
const STAGE_LABELS: Record<string,string> = { new_lead:'NEW LEAD', contacted:'CONTACTED', opened:'OPENED', replied:'REPLIED', interested:'INTERESTED', meeting_booked:'MEETING BOOKED', proposal_sent:'PROPOSAL SENT', closed_won:'CLOSED WON', closed_lost:'CLOSED LOST' }
const STAGE_COLORS: Record<string,string> = { new_lead:'#8a7e6e', contacted:'#3b6bef', opened:'#6366f1', replied:'#8b5cf6', interested:'#f59e0b', meeting_booked:'#10b981', proposal_sent:'#06b6d4', closed_won:'#16a34a', closed_lost:'#ef4444' }

export default function PipelinePage() {
  const [leads, setLeads] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [workspaceId, setWorkspaceId] = useState<string|null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: member } = await supabase.from('workspace_members').select('workspace_id').eq('user_id', session.user.id).single()
      if (!member) return
      setWorkspaceId(member.workspace_id)
      const { data } = await supabase.from('pipeline_leads')
        .select('*, prospects(first_name, last_name, company, email, campaigns(name))')
        .eq('workspace_id', member.workspace_id)
        .order('last_activity_at', { ascending: false })
      setLeads(data || [])
    })
  }, [])

  async function sync() {
    const { data: prospects } = await supabase.from('prospects').select('*').eq('workspace_id', workspaceId)
    for (const p of prospects || []) {
      const { data: existing } = await supabase.from('pipeline_leads').select('id').eq('prospect_id', p.id).single()
      if (!existing) {
        await supabase.from('pipeline_leads').insert({ workspace_id: workspaceId, prospect_id: p.id, stage: p.pipeline_stage || 'new_lead' })
      }
    }
    window.location.reload()
  }

  async function moveStage(leadId: string, stage: string) {
    await supabase.from('pipeline_leads').update({ stage }).eq('id', leadId)
    setLeads(prev => prev.map(l => l.id === leadId ? {...l, stage} : l))
  }

  const filtered = leads.filter(l => {
    const p = l.prospects
    if (!search) return true
    return p?.first_name?.toLowerCase().includes(search.toLowerCase()) || p?.company?.toLowerCase().includes(search.toLowerCase())
  })

  const stats = { total: leads.length, active: leads.filter(l => !['closed_won','closed_lost'].includes(l.stage)).length, won: leads.filter(l => l.stage === 'closed_won').length, meetings: leads.filter(l => l.stage === 'meeting_booked').length }

  return (
    <div>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Pipeline</h1>
          <p className="text-sm text-[#8a7e6e]">Track leads from first touch to closed deal</p>
        </div>
        <div className="flex gap-2">
          <button onClick={sync} className="border border-[#e8e3dc] bg-white text-[#1a1a2e] px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5">↻ Sync</button>
          <button className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold">+ Add Lead</button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: 'TOTAL LEADS', value: stats.total, color: 'text-[#1a1a2e]' },
          { label: 'ACTIVE PIPELINE', value: stats.active, color: 'text-[#3b6bef]' },
          { label: 'WIN RATE', value: stats.total > 0 ? ((stats.won/stats.total)*100).toFixed(0)+'%' : '—', color: 'text-green-600' },
          { label: 'MEETINGS THIS WEEK', value: stats.meetings, color: 'text-[#1a1a2e]' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-[#e8e3dc] rounded-xl p-4">
            <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-2">{s.label}</div>
            <div className={"text-3xl font-bold " + s.color}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] bg-white"
          placeholder="Search leads..." />
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
        {STAGES.map(stage => {
          const stageLeads = filtered.filter(l => l.stage === stage)
          return (
            <div key={stage}>
              <div className="flex items-center justify-between px-4 py-2 border-b border-[#f0ece6]" style={{ borderLeftWidth: 3, borderLeftColor: STAGE_COLORS[stage], borderLeftStyle: 'solid' }}>
                <span className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider">{STAGE_LABELS[stage]}</span>
                <span className="text-xs bg-[#f0ece6] text-[#8a7e6e] px-2 py-0.5 rounded-full">{stageLeads.length}</span>
              </div>
              {stageLeads.map(lead => (
                <div key={lead.id} className="px-4 py-3 border-b border-[#f7f4f0] hover:bg-[#faf8f5] flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-[#1a1a2e]">{lead.prospects?.first_name} {lead.prospects?.last_name}</div>
                    <div className="text-xs text-[#8a7e6e]">{lead.prospects?.company} · {(lead.prospects?.campaigns as any)?.name}</div>
                  </div>
                  <select value={lead.stage} onChange={e => moveStage(lead.id, e.target.value)}
                    className="text-xs border border-[#e8e3dc] rounded-lg px-2 py-1 focus:outline-none focus:border-[#3b6bef]">
                    {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                  </select>
                </div>
              ))}
              {stageLeads.length === 0 && <div className="px-4 py-2 text-xs text-[#b0a898] italic">Empty</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}