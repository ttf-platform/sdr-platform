'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function ProspectsPage() {
  const [prospects, setProspects] = useState<any[]>([])
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [campaignFilter, setCampaignFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [workspaceId, setWorkspaceId] = useState<string|null>(null)
  const [profile, setProfile] = useState<any>(null)
  const [showIcp, setShowIcp] = useState(false)
  const [icpText, setIcpText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parsedIcp, setParsedIcp] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: member } = await supabase.from('workspace_members').select('workspace_id').eq('user_id', session.user.id).single()
      if (!member) return
      setWorkspaceId(member.workspace_id)
      const { data: p } = await supabase.from('workspace_profiles').select('*').eq('workspace_id', member.workspace_id).single()
      setProfile(p)
      if (p?.icp_description) setIcpText(p.icp_description)
      const { data: camps } = await supabase.from('campaigns').select('id, name').eq('workspace_id', member.workspace_id)
      setCampaigns(camps || [])
      const { data: prox } = await supabase.from('prospects').select('*, campaigns(name)').eq('workspace_id', member.workspace_id).order('created_at', { ascending: false })
      setProspects(prox || [])
    })
  }, [])

  async function parseIcp() {
    setParsing(true)
    const res = await fetch('/api/icp/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: icpText }) }).then(r => r.json())
    if (res.icp) setParsedIcp(res.icp)
    setParsing(false)
  }

  async function saveIcp() {
    setSaving(true)
    await fetch('/api/workspace/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: workspaceId, icp_description: icpText, icp_industries: parsedIcp?.industries || profile?.icp_industries, icp_titles: parsedIcp?.titles || profile?.icp_titles, icp_regions: parsedIcp?.regions || profile?.icp_regions, icp_company_size: parsedIcp?.company_size || profile?.icp_company_size, tone: profile?.tone }) })
    setSaving(false)
    setShowIcp(false)
  }

  const filtered = prospects.filter(p => {
    const matchFilter = filter === 'all' || p.status === filter
    const matchSearch = !search || p.email?.toLowerCase().includes(search.toLowerCase()) || p.first_name?.toLowerCase().includes(search.toLowerCase()) || p.last_name?.toLowerCase().includes(search.toLowerCase()) || p.company?.toLowerCase().includes(search.toLowerCase())
    const matchCampaign = campaignFilter === 'all' || p.campaign_id === campaignFilter
    const matchSource = sourceFilter === 'all' || p.source === sourceFilter
    return matchFilter && matchSearch && matchCampaign && matchSource
  })

  const lifecycleStages = ['Found', 'Emailed', 'Opened', 'Replied', 'Meeting']
  const statusColor = (s: string) => s === 'replied' ? 'bg-green-50 text-green-600' : s === 'opened' ? 'bg-blue-50 text-blue-600' : s === 'contacted' ? 'bg-purple-50 text-purple-600' : s === 'bounced' ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-500'

  return (
    <div>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Prospects</h1>
          <p className="text-sm text-[#8a7e6e]">All your prospects across campaigns</p>
        </div>
        <div className="flex gap-2">
          <a href="/dashboard/prospects/import" className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">⬆ Import CSV</a>
          <button onClick={() => setShowIcp(!showIcp)} className="border border-[#e8e3dc] bg-white text-[#1a1a2e] px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5">🎯 ICP Settings</button>
        </div>
      </div>

      {showIcp && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-red-500">🎯</span>
              <span className="font-bold text-[#1a1a2e]">Master ICP</span>
              <span className="text-xs bg-[#eef1fd] text-[#3b6bef] px-2 py-0.5 rounded-full font-medium">Source of truth</span>
            </div>
            <button onClick={() => setShowIcp(false)} className="text-[#8a7e6e] hover:text-[#1a1a2e] text-lg">✕</button>
          </div>
          <p className="text-xs text-[#8a7e6e] mb-3">Define your ideal customer once. All new campaigns auto-fill from this.</p>
          <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-xl p-4 mb-4">
            <div className="text-xs font-semibold text-[#3b6bef] mb-2">✨ Describe your target customer in plain English</div>
            <textarea value={icpText} onChange={e => setIcpText(e.target.value)}
              className="w-full bg-transparent text-sm text-[#4a3f32] resize-none focus:outline-none" rows={3}
              placeholder="e.g. I want to target B2B SaaS founders in Europe who are struggling with outbound sales and have 10-200 employees..." />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-[#8a7e6e]">AI will auto-fill all fields below</span>
              <button onClick={parseIcp} disabled={parsing || !icpText} className="bg-[#3b6bef] text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40">
                {parsing ? 'Parsing...' : '✨ Parse with AI'}
              </button>
            </div>
          </div>
          <div className="text-sm font-semibold text-[#3b6bef] mb-3">Structured ICP</div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Target Industry</label>
              <input value={parsedIcp?.industries?.join(', ') || profile?.icp_industries?.join(', ') || ''} onChange={e => setParsedIcp({...parsedIcp, industries: e.target.value.split(', ')})}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="Indie watch brands" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Target Titles</label>
              <input value={parsedIcp?.titles?.join(', ') || profile?.icp_titles?.join(', ') || ''} onChange={e => setParsedIcp({...parsedIcp, titles: e.target.value.split(', ')})}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="e.g. CEO, CTO, VP Sales" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Target Regions</label>
              <input value={parsedIcp?.regions?.join(', ') || profile?.icp_regions?.join(', ') || ''} onChange={e => setParsedIcp({...parsedIcp, regions: e.target.value.split(', ')})}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="e.g. US, Europe, APAC" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] mb-2 block">Company Size (select all that apply)</label>
              <div className="flex flex-wrap gap-2">
                {['1-10','11-50','51-200','201-1000','1000+'].map(s => (
                  <button key={s} onClick={() => setParsedIcp({...parsedIcp, company_size: s})}
                    className={"text-xs px-2.5 py-1 rounded-full border transition-colors " + ((parsedIcp?.company_size === s || profile?.icp_company_size === s) ? 'bg-[#3b6bef] text-white border-[#3b6bef]' : 'border-[#e8e3dc] text-[#6b5e4e]')}>{s}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="mb-4">
            <label className="text-xs font-semibold text-[#6b5e4e] mb-2 block">Company Revenue (optional)</label>
            <div className="flex flex-wrap gap-2">
              {['<$1M','$1M-$5M','$5M-$10M','$10M-$50M','$50M-$200M','$200M+'].map(r => (
                <button key={r} onClick={() => setParsedIcp({...parsedIcp, revenue: r})}
                  className={"text-xs px-2.5 py-1 rounded-full border transition-colors " + (parsedIcp?.revenue === r ? 'bg-[#3b6bef] text-white border-[#3b6bef]' : 'border-[#e8e3dc] text-[#6b5e4e]')}>{r}</button>
              ))}
            </div>
          </div>
          <div className="mb-4">
            <div className="text-sm font-semibold text-[#3b6bef] mb-2">Tone & Context</div>
            <label className="text-xs font-semibold text-[#6b5e4e] mb-2 block">Email tone</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {['Professional','Casual','Direct','Friendly','Witty'].map(t => (
                <button key={t} onClick={() => setParsedIcp({...parsedIcp, tone: t.toLowerCase()})}
                  className={"text-xs px-3 py-1.5 rounded-lg border transition-colors " + ((parsedIcp?.tone === t.toLowerCase() || profile?.tone === t.toLowerCase()) ? 'bg-[#3b6bef] text-white border-[#3b6bef]' : 'border-[#e8e3dc] text-[#6b5e4e]')}>{t}</button>
              ))}
            </div>
            <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Pain points / Buying signals <span className="text-[#b0a898] font-normal">OPTIONAL</span></label>
            <textarea value={parsedIcp?.pain_points?.join(', ') || profile?.pain_points || ''}
              onChange={e => setParsedIcp({...parsedIcp, pain_points: [e.target.value]})}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" rows={2} />
          </div>
          <div className="flex justify-between">
            <button onClick={() => { setParsedIcp(null); setIcpText(profile?.icp_description || '') }} className="text-sm text-[#8a7e6e]">Reset</button>
            <button onClick={saveIcp} disabled={saving} className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
              {saving ? 'Saving...' : 'Save Master ICP'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-4 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] mb-3" placeholder="Search by name, company, email..." />
        <div className="flex gap-2 flex-wrap items-center">
          {['all','contacted','opened','replied','bounced'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={"text-sm px-3 py-1.5 rounded-lg border transition-colors capitalize " + (filter === f ? 'bg-[#3b6bef] text-white border-[#3b6bef]' : 'border-[#e8e3dc] text-[#6b5e4e]')}>{f === 'all' ? 'All' : f}</button>
          ))}
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="border border-[#e8e3dc] rounded-lg px-3 py-1.5 text-sm text-[#6b5e4e] focus:outline-none">
            <option value="all">All Sources</option>
            <option value="csv">CSV Import</option>
            <option value="ai">AI Generated</option>
            <option value="manual">Manual</option>
          </select>
          <select value={campaignFilter} onChange={e => setCampaignFilter(e.target.value)} className="border border-[#e8e3dc] rounded-lg px-3 py-1.5 text-sm text-[#6b5e4e] focus:outline-none">
            <option value="all">All Campaigns</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="border border-[#e8e3dc] rounded-lg px-3 py-1.5 text-sm text-[#6b5e4e] focus:outline-none">
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="name">Name A-Z</option>
          </select>
          <span className="ml-auto text-sm text-[#8a7e6e]">{filtered.length} prospects</span>
        </div>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#f0ece6]">
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">NAME</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">COMPANY</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">EMAIL</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">CAMPAIGN</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">LIFECYCLE</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">STATUS</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">SOURCE</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">DATE ADDED</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-[#8a7e6e]">No prospects yet. Import a CSV to get started.</td></tr>
            ) : filtered.map(p => (
              <tr key={p.id} className="border-b border-[#f7f4f0] hover:bg-[#faf8f5]">
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-[#1a1a2e]">{p.first_name} {p.last_name}</div>
                  <div className="text-xs text-[#8a7e6e]">{p.title}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm text-[#1a1a2e]">{p.company}</div>
                </td>
                <td className="px-4 py-3 text-sm text-[#8a7e6e]">{p.email}</td>
                <td className="px-4 py-3">
                  {(p.campaigns as any)?.name && (
                    <span className="text-xs text-[#3b6bef] font-medium">{(p.campaigns as any).name} ↗</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {lifecycleStages.map((stage, i) => {
                      const stageStatus = p.status
                      const stageMap: Record<string,number> = { contacted: 1, opened: 2, replied: 3, meeting: 4 }
                      const currentIdx = stageMap[stageStatus] || 0
                      const isActive = i === currentIdx
                      const isPast = i < currentIdx
                      return (
                        <span key={stage} className={"text-xs px-1.5 py-0.5 rounded font-medium " + (isActive ? 'bg-[#3b6bef] text-white' : isPast ? 'text-[#8a7e6e]' : 'text-[#d0c8be]')}>{stage}</span>
                      )
                    })}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={"text-xs px-2 py-0.5 rounded-full capitalize font-medium " + statusColor(p.status || 'new')}>
                    {p.status || 'new'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={"text-xs px-2 py-0.5 rounded-full capitalize " + (p.source === 'csv' ? 'bg-blue-50 text-blue-600' : p.source === 'ai' ? 'bg-purple-50 text-purple-600' : 'bg-gray-50 text-gray-500')}>
                    {p.source === 'ai' ? 'AI Generated' : p.source === 'csv' ? 'CSV Import' : 'Manual'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-[#8a7e6e]">{new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}