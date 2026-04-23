'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Megaphone, Users, BarChart2, Mail, Calendar, TrendingUp, Settings, Sun, UserPlus, Phone } from 'lucide-react'

const supabase = createClient()

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null)
  const [workspace, setWorkspace] = useState<any>(null)
  const [role, setRole] = useState<string>('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const avatarRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      setUser(session.user)
      const { data: member } = await supabase.from('workspace_members')
        .select('workspace_id, role, workspaces(name, plan, credits)')
        .eq('user_id', session.user.id).single()
      if (member) { setWorkspace(member); setRole(member.role) }
    })
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setAvatarOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/dashboard/campaigns', label: 'Campaigns', icon: Megaphone },
    { href: '/dashboard/prospects', label: 'Prospects', icon: Users },
    { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart2 },
    { href: '/dashboard/inbox', label: 'Inbox', icon: Mail },
    { href: '/dashboard/meetings', label: 'Meetings', icon: Calendar },
    { href: '/dashboard/morning-brief', label: 'Morning Brief', icon: Sun },
    { href: '/dashboard/pipeline', label: 'Pipeline', icon: TrendingUp },
    { href: '/dashboard/call-recording', label: 'Call Recording', icon: Phone },
    { href: '/dashboard/team', label: 'Team', icon: UserPlus },
    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  ]

  const isActive = (href: string) => href === '/dashboard' ? pathname === href : pathname.startsWith(href)
  const ws = (workspace?.workspaces as any)
  const initials = user?.user_metadata?.full_name?.charAt(0)?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'

  if (!user) return <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center"><div className="text-sm text-[#8a7e6e]">Loading...</div></div>

  return (
    <div className="min-h-screen bg-[#f5f2ee]">
      <nav className="bg-white border-b border-[#e8e3dc] sticky top-0 z-50">
        <div className="flex items-center px-4 h-12 gap-1">
          <Link href="/dashboard" className="flex items-center gap-1 mr-4 flex-shrink-0">
            <span className="font-bold text-[#1a1a2e] text-lg">Sen<span className="text-[#3b6bef]">tra</span></span>
          </Link>

          <div className="hidden md:flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-hide">
            {navItems.map(item => {
              const Icon = item.icon
              const active = isActive(item.href)
              return (
                <Link key={item.href} href={item.href}
                  className={"flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors font-medium " +
                    (active ? 'bg-[#eef1fd] text-[#3b6bef]' : 'text-[#4a4a5a] hover:bg-[#f0ece6] hover:text-[#1a1a2e]')}>
                  <Icon size={14} strokeWidth={active ? 2.5 : 2} />
                  {item.label}
                </Link>
              )
            })}
          </div>

          <div className="hidden md:flex items-center gap-2 ml-auto flex-shrink-0">
            {role === 'owner' && (
              <Link href="/dashboard/admin"
                className={"flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-semibold " + (pathname.startsWith('/dashboard/admin') ? 'bg-purple-100 text-purple-700' : 'text-purple-600 hover:bg-purple-50')}>
                ♦ Admin
              </Link>
            )}
            <span className="text-xs text-[#8a7e6e] bg-[#f0ece6] px-2 py-1 rounded-lg whitespace-nowrap">
              {ws?.credits || 100} / 100 credits
            </span>
            <div ref={avatarRef} className="relative">
              <button onClick={() => setAvatarOpen(!avatarOpen)}
                className="w-8 h-8 rounded-full bg-[#3b6bef] flex items-center justify-center text-white text-sm font-bold hover:opacity-90">
                {initials}
              </button>
              {avatarOpen && (
                <div className="absolute right-0 top-10 w-56 bg-white border border-[#e8e3dc] rounded-xl shadow-lg overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-[#f0ece6]">
                    <div className="text-xs text-[#8a7e6e] truncate">{user?.email}</div>
                  </div>
                  <Link href="/dashboard/settings" onClick={() => setAvatarOpen(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#1a1a2e] hover:bg-[#f7f4f0]">
                    <Settings size={14} /> Settings
                  </Link>
                  {role === 'owner' && (
                    <Link href="/dashboard/admin" onClick={() => setAvatarOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-purple-600 font-medium hover:bg-purple-50">
                      ♦ Admin <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded ml-auto">ADMIN</span>
                    </Link>
                  )}
                  <div className="border-t border-[#f0ece6]">
                    <Link href="/" onClick={() => setAvatarOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#6b5e4e] hover:bg-[#f7f4f0]">
                      ← Homepage
                    </Link>
                    <button onClick={signOut}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50">
                      ⏻ Log out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <button className="md:hidden ml-auto p-2 text-[#6b5e4e]" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-[#e8e3dc] bg-white">
            {navItems.map(item => {
              const Icon = item.icon
              return (
                <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)}
                  className={"flex items-center gap-2 px-4 py-3 text-sm border-b border-[#f0ece6] " +
                    (isActive(item.href) ? 'text-[#3b6bef] font-medium bg-[#eef1fd]' : 'text-[#4a4a5a]')}>
                  <Icon size={15} /> {item.label}
                </Link>
              )
            })}
            {role === 'owner' && (
              <Link href="/dashboard/admin" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-4 py-3 text-sm border-b border-[#f0ece6] text-purple-600 font-medium">
                ♦ Admin Dashboard
              </Link>
            )}
            <Link href="/" className="flex items-center gap-2 px-4 py-3 text-sm border-b border-[#f0ece6] text-[#6b5e4e]">← Homepage</Link>
            <button onClick={signOut} className="w-full text-left px-4 py-3 text-sm text-red-500">⏻ Log out</button>
          </div>
        )}
      </nav>

      <main className="p-4 md:p-6">
        {children}
      </main>
    </div>
  )
}