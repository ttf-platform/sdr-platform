'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function DashboardPage() {
  const [campaigns, setCampaigns] = useState<any[]>([])
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
          .limit(5)
        setCampaigns(data || [])
      }
    })
  }, [])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#1a1a2e]">Dashboard</h1>
          <p className="text-sm text-[#8a7e6e]">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
        <a href="/dashboard/campaigns/new" className="bg-[#1a1a2e] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2d2d4e] transition-colors">+ New Campaign</a>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Emails sent', value: '0' },
          { label: 'Open rate', value: '0%' },
          { label: 'Reply rate', value: '0%' },
          { label: 'Meetings booked', value: '0' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white border border-[#e8e3dc] rounded-xl p-4">
            <div className="text-xs font-medium text-[#8a7e6e] uppercase tracking-wide mb-2">{kpi.label}</div>
            <div className="text-2xl font-mono font-medium text-[#1a1a2e]">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#f0ece6] flex items-center justify-between">
            <span className="text-sm font-semibold text-[#1a1a2e]">Campaigns</span>
            <a href="/dashboard/campaigns" className="text-xs text-[#3b6bef] font-medium">View all →</a>
          </div>
          {campaigns.length > 0 ? campaigns.map(c => (
            <div key={c.id} className="px-4 py-3 border-b border-[#f7f4f0] flex items-center gap-3">
              <div className={"w-2 h-2 rounded-full " + (c.status === 'active' ? 'bg-green-500' : c.status === 'draft' ? 'bg-amber-400' : 'bg-gray-300')}></div>
              <div className="flex-1">
                <div className="text-sm font-medium text-[#1a1a2e]">{c.name}</div>
                <div className="text-xs text-[#8a7e6e]">{c.prospect_count} prospects</div>
              </div>
            </div>
          )) : (
            <div className="px-4 py-12 text-center">
              <div className="text-sm text-[#8a7e6e] mb-3">No campaigns yet</div>
              <a href="/dashboard/campaigns/new" className="text-sm text-[#3b6bef] font-medium">Create your first campaign →</a>
            </div>
          )}
        </div>
        <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden border-t-2 border-t-[#3b6bef]">
          <div className="px-4 py-3 border-b border-[#f0ece6] bg-[#f7f8ff]">
            <span className="text-sm font-semibold text-[#1a1a2e]">Morning Brief</span>
          </div>
          <div className="p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-[#3b6bef] mb-2">Getting started</div>
            <div className="flex flex-col gap-2 mt-3">
              {[
                { label: 'Connect your email', href: '/dashboard/settings' },
                { label: 'Set up your ICP', href: '/dashboard/settings' },
                { label: 'Create a campaign', href: '/dashboard/campaigns/new' },
              ].map(item => (
                <a key={item.label} href={item.href} className="flex items-center gap-2 text-xs text-[#6b5e4e] hover:text-[#3b6bef]">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#3b6bef]"></div>
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}