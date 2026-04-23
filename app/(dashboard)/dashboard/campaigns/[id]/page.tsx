'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function CampaignDetailPage({ params }: { params: { id: string } }) {
  const [campaign, setCampaign] = useState<any>(null)
  const [steps, setSteps] = useState<any[]>([])
  const [prospects, setProspects] = useState<any[]>([])
  const [tab, setTab] = useState<'sequence'|'prospects'|'analytics'>('sequence')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: camp } = await supabase.from('campaigns').select('*').eq('id', params.id).single()
      setCampaign(camp)
      const { data: s } = await supabase.from('campaign_steps').select('*').eq('campaign_id', params.id).order('step_number')
      setSteps(s || [])
      const { data: p } = await supabase.from('prospects').select('*').eq('campaign_id', params.id).order('created_at', { ascending: false })
      setProspects(p || [])
      setLoading(false)
    })
  }, [params.id])

  async function launch() {
    await supabase.from('campaigns').update({ status: 'active' }).eq('id', params.id)
    setCampaign((prev: any) => ({...prev, status: 'active'}))
  }

  async function pause() {
    await supabase.from('campaigns').update({ status: 'paused' }).eq('id', params.id)
    setCampaign((prev: any) => ({...prev, status: 'paused'}))
  }

  if (loading) return <div className="p-6 text-sm text-[#8a7e6e]">Loading...</div>
  if (!campaign) return <div className="p-6 text-sm text-red-500">Campaign not found</div>

  return (
    <div>
      <div className="flex items-start justify-between mb-2">
        <div>
          <a href="/dashboard/campaigns" className="text-xs text-[#8a7e6e] hover:text-[#1a1a2e] mb-2 inline-block">← Back to campaigns</a>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">{campaign.name}</h1>
          {campaign.icp_snapshot?.icp && <p className="text-sm text-[#8a7e6e] mt-1">{campaign.icp_snapshot.icp}</p>}
        </div>
        <div className="flex gap-2 items-center">
          <span className={"text-xs px-2 py-1 rounded-full font-medium " + (campaign.status === 'active' ? 'bg-green-50 text-green-600' : campaign.status === 'paused' ? 'bg-amber-50 text-amber-600' : 'bg-gray-50 text-gray-500')}>
            {campaign.status}
          </span>
          {campaign.status === 'active' ? (
            <button onClick={pause} className="border border-[#e8e3dc] bg-white text-[#1a1a2e] px-3 py-2 rounded-lg text-sm font-medium">⏸ Pause</button>
          ) : (
            <button onClick={launch} className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold">🚀 Launch Campaign</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-5 mt-4">
        {[
          { label: 'PROSPECTS', value: campaign.prospect_count || prospects.length },
          { label: 'SENT', value: campaign.sent_count || 0 },
          { label: 'OPENS', value: campaign.sent_count > 0 ? ((campaign.open_count/campaign.sent_count)*100).toFixed(1)+'%' : '—' },
          { label: 'REPLIES', value: campaign.sent_count > 0 ? ((campaign.reply_count/campaign.sent_count)*100).toFixed(1)+'%' : '—' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-[#e8e3dc] rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-[#1a1a2e]">{s.value}</div>
            <div className="text-xs text-[#8a7e6e] uppercase tracking-wider mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 mb-4 border border-[#e8e3dc] rounded-xl p-1 bg-white w-fit">
        {(['sequence','prospects','analytics'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={"px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors " + (tab === t ? 'bg-white border border-[#e8e3dc] text-[#1a1a2e] shadow-sm' : 'text-[#8a7e6e]')}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'sequence' && (
        <div className="flex flex-col gap-3">
          {steps.length === 0 ? (
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-8 text-center">
              <div className="text-sm text-[#8a7e6e] mb-3">No sequence yet</div>
              <a href={"/dashboard/campaigns/new?edit="+params.id} className="text-sm text-[#3b6bef] font-medium">Generate sequence with AI →</a>
            </div>
          ) : steps.map(step => (
            <div key={step.id} className="bg-white border border-[#e8e3dc] rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#3b6bef] text-white text-xs flex items-center justify-center font-bold">{step.step_number}</div>
                  <span className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">Email {step.step_number} · {step.step_number === 1 ? 'Day 0' : 'Day +'+(step.delay_days || (step.step_number-1)*3)}</span>
                </div>
              </div>
              <div className="text-sm font-semibold text-[#1a1a2e] mb-2">{step.subject}</div>
              <div className="text-sm text-[#4a3f32] leading-relaxed whitespace-pre-wrap">{step.body}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'prospects' && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#f0ece6]">
            <span className="text-sm font-semibold text-[#1a1a2e]">{prospects.length} prospects</span>
            <a href="/dashboard/prospects" className="text-xs text-[#3b6bef] font-medium">+ Add prospects →</a>
          </div>
          {prospects.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#8a7e6e]">No prospects yet. Import a CSV or use AI to find prospects.</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#f0ece6]">
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">NAME</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">COMPANY</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {prospects.map(p => (
                  <tr key={p.id} className="border-b border-[#f7f4f0]">
                    <td className="px-5 py-3 text-sm text-[#1a1a2e]">{p.first_name} {p.last_name}</td>
                    <td className="px-5 py-3 text-sm text-[#8a7e6e]">{p.company}</td>
                    <td className="px-5 py-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full capitalize " + (p.status === 'replied' ? 'bg-green-50 text-green-600' : p.status === 'opened' ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-500')}>{p.status || 'pending'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'analytics' && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-8 text-center">
          <div className="text-sm text-[#8a7e6e]">Analytics will appear once emails are sent.</div>
        </div>
      )}
    </div>
  )
}