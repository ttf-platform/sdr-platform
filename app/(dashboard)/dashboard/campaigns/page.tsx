'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [workspaceId, setWorkspaceId] = useState<string|null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: member } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', session.user.id)
        .single()
      if (member) {
        setWorkspaceId(member.workspace_id)
        const { data } = await supabase
          .from('campaigns')
          .select('*')
          .eq('workspace_id', member.workspace_id)
          .order('created_at', { ascending: false })
        setCampaigns(data || [])
      }
      setLoading(false)
    })
  }, [])

  const statusColor = (s: string) => s === 'active' ? 'bg-green-500' : s === 'draft' ? 'bg-amber-400' : 'bg-gray-300'

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#1a1a2e]">Campaigns</h1>
          <p className="text-sm text-[#8a7e6e]">Manage your outbound sequences</p>
        </div>
        <div className="flex gap-2">
          <a href="/dashboard/campaigns/suggestions" className="border border-[#e8e3dc] bg-white text-[#1a1a2e] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#f0ece6] transition-colors flex items-center gap-2">
            ✦ AI Suggestions
          </a>
          <a href="/dashboard/campaigns/new" className="bg-[#1a1a2e] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2d2d4e] transition-colors">
            + New Campaign
          </a>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-[#8a7e6e]">Loading...</div>
      ) : campaigns.length === 0 ? (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center">
          <div className="text-4xl mb-4">✦</div>
          <h2 className="text-lg font-bold text-[#1a1a2e] mb-2">No campaigns yet</h2>
          <p className="text-sm text-[#8a7e6e] mb-6">Let AI suggest campaigns based on your ICP, or create one manually.</p>
          <div className="flex gap-3 justify-center">
            <a href="/dashboard/campaigns/suggestions" className="border border-[#3b6bef] text-[#3b6bef] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#eef1fd]">
              ✦ Get AI Suggestions
            </a>
            <a href="/dashboard/campaigns/new" className="bg-[#1a1a2e] text-white px-4 py-2 rounded-lg text-sm font-medium">
              Create manually
            </a>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#f0ece6]">
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wide">Campaign</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wide">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wide">Prospects</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wide">Open</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wide">Reply</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id} className="border-b border-[#f7f4f0] hover:bg-[#faf8f5]">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-[#1a1a2e]">{c.name}</div>
                    <div className="text-xs text-[#8a7e6e]">{new Date(c.created_at).toLocaleDateString()}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={"w-2 h-2 rounded-full " + statusColor(c.status)}></div>
                      <span className="text-xs capitalize text-[#6b5e4e]">{c.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-[#1a1a2e]">{c.prospect_count}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-[#1a1a2e]">{c.sent_count > 0 ? Math.round(c.open_count/c.sent_count*100) + '%' : '—'}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-[#1a1a2e]">{c.sent_count > 0 ? Math.round(c.reply_count/c.sent_count*100) + '%' : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <a href={"/dashboard/campaigns/" + c.id} className="text-xs text-[#3b6bef] font-medium hover:underline">View →</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}