import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: workspace } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces(name, plan, seats_limit)')
    .eq('user_id', user.id)
    .single()

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: 'grid' },
    { href: '/dashboard/campaigns', label: 'Campaigns', icon: 'mail' },
    { href: '/dashboard/prospects', label: 'Prospects', icon: 'users' },
    { href: '/dashboard/inbox', label: 'Inbox', icon: 'inbox' },
    { href: '/dashboard/pipeline', label: 'Pipeline', icon: 'bar-chart' },
    { href: '/dashboard/analytics', label: 'Analytics', icon: 'trending-up' },
    { href: '/dashboard/morning-brief', label: 'Morning Brief', icon: 'sun' },
    { href: '/dashboard/meetings', label: 'Meetings', icon: 'calendar' },
    { href: '/dashboard/team', label: 'Team', icon: 'user-plus' },
    { href: '/dashboard/settings', label: 'Settings', icon: 'settings' },
  ]

  return (
    <div className="flex h-screen bg-[#f5f2ee]">
      <aside className="w-56 bg-[#faf8f5] border-r border-[#e8e3dc] flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-[#ede8e1]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-[#1a1a2e] rounded-lg flex items-center justify-center">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M2 7L5.5 10.5L12 3.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="font-bold text-[#1a1a2e]">Sen<span className="text-[#3b6bef]">tra</span></span>
          </div>
        </div>

        {workspace && (
          <div className="mx-2 mt-3 bg-[#f0ece6] rounded-lg px-3 py-2 border border-[#e0dbd4]">
            <div className="text-xs font-semibold text-[#1a1a2e] truncate">
              {(workspace.workspaces as any)?.name || 'My Workspace'}
            </div>
            <div className="text-[10px] text-[#8a7e6e]">
              {(workspace.workspaces as any)?.plan || 'trial'} · {workspace.role}
            </div>
          </div>
        )}

        <nav className="flex-1 p-2 mt-2 flex flex-col gap-0.5">
          {navItems.map(item => (
            <Link key={item.href} href={item.href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[#6b5e4e] text-sm hover:bg-[#ede8e1] hover:text-[#1a1a2e] transition-colors">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-[#ede8e1]">
          <div className="flex items-center gap-2 px-2 py-1.5 bg-[#f0ece6] rounded-lg border border-[#e0dbd4]">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#3b6bef] to-[#8b5cf6] flex items-center justify-center text-white text-[10px] font-bold">
              {user.email?.[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-[#1a1a2e] truncate">{user.email}</div>
            </div>
          </div>
          <form action="/api/auth/signout" method="POST" className="mt-2">
            <button className="w-full text-xs text-[#8a7e6e] hover:text-[#1a1a2e] text-left px-2 py-1">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}