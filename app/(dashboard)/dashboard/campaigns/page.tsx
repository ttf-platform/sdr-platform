'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function CampaignsPage() {
  const [tab, setTab] = useState<'my'|'ai'>('my')
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [profile, setProfile] = useState<any>(null)
  const [workspaceId, setWorkspaceId] = useState<string|null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      const { data: member } = await supabase.from('workspace_members').select('workspace_id').eq('user_id', session.user.id).single()
      if (!member) { setLoading(false); return }
      setWorkspaceId(member.workspace_id)
      const { data: p } = await supabase.from('workspace_profiles').select('*').eq('workspace_id', member.workspace_id).single()
      setProfile(p)
      const { data: camps, error } = await supabase.from('campaigns').select('*').eq('workspace_id', member.workspace_id).order('created_at', { ascending: false })
      if (!error) setCampaigns(camps || [])
      setLoading(false)
    })
  }, [])

  async function getSuggestions() {
    setLoadingSuggestions(true)
    setSuggestions([])
    try {
      const res = await fetch('/api/campaigns/suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }) }).then(r => r.json())
      setSuggestions(res.suggestions || [])
    } catch {}
    setLoadingSuggestions(false)
  }

  useEffect(() => { if (tab === 'ai' && suggestions.length === 0 && profile) getSuggestions() }, [tab, profile])

  async function deleteCampaign(id: string) {
    if (!confirm('Delete this campaign?')) return
    await supabase.from('campaigns').delete().eq('id', id)
    setCampaigns(prev => prev.filter(c => c.id !== id))
  }

  function useSuggestion(s: any) {
    const params = new URLSearchParams({ name: s.name || '', icp: s.icp || '', hook: s.hook || '', tone: s.tone || 'professional' })
    window.location.href = '/dashboard/campaigns/new?' + params.toString()
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Campaigns</h1>
          <p className="text-sm text-[#8a7e6e]">Manage your outbound campaigns</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-1.5 border border-[#e8e3dc] bg-white text-[#1a1a2e] px-3 py-2 rounded-lg text-sm font-medium">🕐 Sending Preferences</button>
          <a href="/dashboard/campaigns/new" className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold">+ New Campaign</a>
        </div>
      </div>

      <div className="flex gap-1 mb-6 p-1 bg-[#f0ece6] rounded-xl w-fit">
        <button onClick={() => setTab('my')} className={"px-4 py-2 rounded-lg text-sm font-medium transition-colors " + (tab === 'my' ? 'bg-white shadow-sm text-[#1a1a2e]' : 'text-[#8a7e6e]')}>My Campaigns</button>
        <button onClick={() => setTab('ai')} className={"px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 " + (tab === 'ai' ? 'bg-white shadow-sm text-[#1a1a2e]' : 'text-[#8a7e6e]')}>✨ AI Suggestions</button>
      </div>

      {tab === 'my' && (
        loading ? <div className="text-sm text-[#8a7e6e] py-8 text-center">Loading campaigns...</div> :
        campaigns.length === 0 ? (
          <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center">
            <div className="text-3xl mb-3">✨</div>
            <h2 className="text-lg font-bold text-[#1a1a2e] mb-2">No campaigns yet</h2>
            <p className="text-sm text-[#8a7e6e] mb-4">Let AI suggest campaigns based on your ICP, or create one manually.</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setTab('ai')} className="border border-[#3b6bef] text-[#3b6bef] px-4 py-2 rounded-lg text-sm font-medium">✨ AI Suggestions</button>
              <a href="/dashboard/campaigns/new" className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-medium">+ New Campaign</a>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map(c => (
              <div key={c.id} className="bg-white border border-[#e8e3dc] rounded-xl p-5">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-bold text-[#1a1a2e] text-base leading-tight flex-1 pr-2">{c.name}</h3>
                  <span className={"text-xs px-2 py-0.5 rounded font-medium flex-shrink-0 " + (c.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600')}>{c.status}</span>
                </div>
                {c.icp_snapshot?.icp && <p className="text-xs text-[#8a7e6e] mb-4 line-clamp-2">{c.icp_snapshot.icp}</p>}
                <div className="grid grid-cols-4 gap-2 mb-4 py-3 border-t border-b border-[#f0ece6]">
                  {[
                    { label: 'PROSPECTS', value: c.prospect_count || 0 },
                    { label: 'SENT', value: c.sent_count || 0 },
                    { label: 'OPENS', value: c.sent_count > 0 ? ((c.open_count/c.sent_count)*100).toFixed(1)+'%' : '—' },
                    { label: 'REPLIES', value: c.sent_count > 0 ? ((c.reply_count/c.sent_count)*100).toFixed(1)+'%' : '—' },
                  ].map(s => (
                    <div key={s.label} className="text-center">
                      <div className="text-base font-bold text-[#1a1a2e]">{s.value}</div>
                      <div className="text-[10px] text-[#8a7e6e] uppercase tracking-wide">{s.label}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <a href={"/dashboard/campaigns/" + c.id} className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-medium">Open Campaign →</a>
                  <button onClick={() => deleteCampaign(c.id)} className="text-sm text-red-500 font-medium">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'ai' && (
        <div>
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-[#1a1a2e] flex items-center gap-2">✨ AI-Suggested Campaigns</h2>
              <p className="text-sm text-[#8a7e6e]">Strategically different campaigns tailored to your product — ready to launch in one click.</p>
            </div>
            <button onClick={getSuggestions} disabled={loadingSuggestions} className="border border-[#e8e3dc] bg-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
              ↻ {loadingSuggestions ? 'Generating...' : 'Refresh suggestions'}
            </button>
          </div>
          {loadingSuggestions ? (
            <div className="text-center py-16">
              <div className="text-2xl mb-3">✨</div>
              <div className="text-sm text-[#8a7e6e]">Analyzing your product and generating strategic campaign ideas...</div>
              <div className="text-xs text-[#b0a898] mt-1">This may take up to 30 seconds</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {suggestions.map((s, i) => (
                <div key={i} className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden hover:border-[#3b6bef] transition-colors">
                  <div className="h-1 bg-gradient-to-r from-[#3b6bef] to-[#8b5cf6]"></div>
                  <div className="p-5">
                    <div className="text-xs font-semibold text-[#8b5cf6] uppercase tracking-wider mb-3 flex items-center gap-1">✨ AI SUGGESTION</div>
                    <h3 className="font-bold text-[#1a1a2e] text-base mb-1">{s.name}</h3>
                    <p className="text-sm text-[#8a7e6e] italic mb-3">{s.icp}</p>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {s.tone && <span className="text-xs bg-[#f0ece6] text-[#6b5e4e] px-2 py-0.5 rounded-full capitalize">💬 {s.tone}</span>}
                    </div>
                    <div className="bg-[#f0f4ff] border-l-4 border-[#3b6bef] rounded-r-lg p-3 mb-4">
                      <p className="text-sm text-[#3b6bef] font-semibold">💡 {s.hook}</p>
                    </div>
                    <button onClick={() => useSuggestion(s)} className="w-full bg-[#3b6bef] text-white py-2 rounded-lg text-sm font-medium">Use this suggestion →</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}