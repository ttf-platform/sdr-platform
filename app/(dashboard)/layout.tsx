'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const supabase = createClient()

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null)
  const [workspace, setWorkspace] = useState<any>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      setUser(session.user)
      const { data: member } = await supabase.from('workspace_members')
        .select('workspace_id, role, workspaces(name, plan)')
        .eq('user_id', session.user.id).single()
      setWorkspace(member)
    })
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: '⊞' },
    { href: '/dashboard/campaigns', label: 'Campaigns', icon: '▸' },
    { href: '/dashboard/prospects', label: 'Prospects', icon: '👤' },
    { href: '/dashboard/analytics', label: 'Analytics', icon: '📊' },
    { href: '/dashboard/inbox', label: 'Inbox', icon: '✉' },
    { href: '/dashboard/meetings', label: 'Meetings', icon: '📅' },
    { href: '/dashboard/pipeline', label: 'Pipeline', icon: '📈' },
    { href: '/dashboard/settings', label: 'Settings', icon: '⚙' },
  ]

  const isActive = (href: string) => href === '/dashboard' ? pathname === href : pathname.startsWith(href)

  if (!user) return <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center"><div className="text-sm text-[#8a7e6e]">Loading...</div></div>

  return (
    <div className="min-h-screen bg-[#f5f2ee]">
      <nav className="bg-white border-b border-[#e8e3dc] sticky top-0 z-50">
        <div className="flex items-center px-4 h-12">
          <Link href="/dashboard" className="flex items-center gap-1 mr-6 flex-shrink-0">
            <span className="font-bold text-[#1a1a2e] text-lg">Sen<span className="text-[#3b6bef]">tra</span></span>
          </Link>

          <div className="hidden md:flex items-center gap-1 flex-1 overflow-x-auto">
            {navItems.map(item => (
              <Link key={item.href} href={item.href}
                className={"flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors " +
                  (isActive(item.href) ? 'bg-[#eef1fd] text-[#3b6bef] font-medium' : 'text-[#6b5e4e] hover:bg-[#f0ece6]')}>
                {item.label}
              </Link>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3 ml-auto flex-shrink-0">
            <span className="text-xs text-[#8a7e6e] bg-[#f0ece6] px-2 py-1 rounded-lg">
              {(workspace?.workspaces as any)?.plan || 'trial'}
            </span>
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#3b6bef] to-[#8b5cf6] flex items-center justify-center text-white text-xs font-bold cursor-pointer"
              onClick={signOut} title="Sign out">
              {user?.email?.[0].toUpperCase()}
            </div>
          </div>

          <button className="md:hidden ml-auto p-2 text-[#6b5e4e]" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-[#e8e3dc] bg-white">
            {navItems.map(item => (
              <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)}
                className={"flex items-center gap-2 px-4 py-3 text-sm border-b border-[#f0ece6] " +
                  (isActive(item.href) ? 'text-[#3b6bef] font-medium bg-[#eef1fd]' : 'text-[#6b5e4e]')}>
                {item.icon} {item.label}
              </Link>
            ))}
            <button onClick={signOut} className="w-full text-left px-4 py-3 text-sm text-red-500">Sign out</button>
          </div>
        )}
      </nav>

      <main className="p-4 md:p-6">
        {children}
      </main>
    </div>
  )
}