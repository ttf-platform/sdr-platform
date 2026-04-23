import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5)

  const { data: inboxMessages } = await supabase
    .from('inbox_messages')
    .select('*')
    .eq('is_read', false)
    .order('received_at', { ascending: false })
    .limit(3)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#1a1a2e]">Dashboard</h1>
          <p className="text-sm text-[#8a7e6e]">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
        <a href="/dashboard/campaigns/new"
          className="bg-[#1a1a2e] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2d2d4e] transition-colors">
          + New Campaign
        </a>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Emails sent', value: '0', delta: 'Start your first campaign' },
          { label: 'Open rate', value: '0%', delta: 'No data yet' },
          { label: 'Reply rate', value: '0%', delta: 'No data yet' },
          { label: 'Meetings booked', value: '0', delta: 'Connect your calendar' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white border border-[#e8e3dc] rounded-xl p-4">
            <div className="text-xs font-medium text-[#8a7e6e] uppercase tracking-wide mb-2">{kpi.label}</div>
            <div className="text-2xl font-mono font-medium text-[#1a1a2e] mb-1">{kpi.value}</div>
            <div className="text-xs text-[#b0a898]">{kpi.delta}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#f0ece6] flex items-center justify-between">
            <span className="text-sm font-semibold text-[#1a1a2e]">Campaigns</span>
            <a href="/dashboard/campaigns" className="text-xs text-[#3b6bef] font-medium">View all →</a>
          </div>
          {campaigns && campaigns.length > 0 ? (
            campaigns.map(c => (
              <div key={c.id} className="px-4 py-3 border-b border-[#f7f4f0] flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${c.status === 'active' ? 'bg-green-500' : c.status === 'draft' ? 'bg-amber-400' : 'bg-gray-300'}`}></div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-[#1a1a2e]">{c.name}</div>
                  <div className="text-xs text-[#8a7e6e]">{c.prospect_count} prospects</div>
                </div>
                <div className="flex gap-4 text-right">
                  <div><div className="text-xs font-mono text-[#1a1a2e]">{c.open_count}</div><div className="text-[10px] text-[#b0a898]">opens</div></div>
                  <div><div className="text-xs font-mono text-[#1a1a2e]">{c.reply_count}</div><div className="text-[10px] text-[#b0a898]">replies</div></div>
                </div>
              </div>
            ))
          ) : (
            <div className="px-4 py-12 text-center">
              <div className="text-sm text-[#8a7e6e] mb-3">No campaigns yet</div>
              <a href="/dashboard/campaigns/new" className="text-sm text-[#3b6bef] font-medium">Create your first campaign →</a>
            </div>
          )}
        </div>

        <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden border-t-2 border-t-[#3b6bef]">
          <div className="px-4 py-3 border-b border-[#f0ece6] flex items-center justify-between bg-[#f7f8ff]">
            <span className="text-sm font-semibold text-[#1a1a2e]">Morning Brief</span>
            <span className="text-xs text-[#8a7e6e]">Today</span>
          </div>
          <div className="p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-[#3b6bef] mb-2">Getting started</div>
            <div className="text-sm text-[#4a3f32] leading-relaxed">
              Welcome to Sentra. Create your first campaign to start generating meetings automatically.
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {[
                { label: 'Connect your email', href: '/dashboard/settings' },
                { label: 'Set up your ICP', href: '/dashboard/settings' },
                { label: 'Create a campaign', href: '/dashboard/campaigns/new' },
              ].map(item => (
                <a key={item.label} href={item.href}
                  className="flex items-center gap-2 text-xs text-[#6b5e4e] hover:text-[#3b6bef] transition-colors">
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