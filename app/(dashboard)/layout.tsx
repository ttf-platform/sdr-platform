'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Megaphone, Users, BarChart2, Mail, Calendar, TrendingUp, Settings, Sun, UserPlus, Phone, CreditCard } from 'lucide-react'
import TrialBadge from '@/components/TrialBadge'
import { getTrialStatus } from '@/lib/trial-status'

const supabase = createClient()

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null)
  const [workspace, setWorkspace] = useState<any>(null)
  const [role, setRole] = useState<string>('')
  const [billingData, setBillingData] = useState<{ blocked: boolean; daysRemaining: number; status: string } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const avatarRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      setUser(session.user)
      const { data: member } = await supabase.from('workspace_members')
        .select('workspace_id, role, workspaces(name, plan, credits, subscription_status, trial_end_date)')
        .eq('user_id', session.user.id).single()
      if (member) {
        setWorkspace(member); setRole(member.role)
        const ws = member.workspaces as any
        const ts = getTrialStatus({ subscription_status: ws?.subscription_status, trial_end_date: ws?.trial_end_date })
        setBillingData({ blocked: ts.blockedActions, daysRemaining: ts.daysRemaining, status: ts.status })
      }
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
    { href: '/dashboard/billing',  label: 'Billing',  icon: CreditCard },
    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  ]

  const isActive = (href: string) => href === '/dashboard' ? pathname === href : pathname.startsWith(href)
  const ws = (workspace?.workspaces as any)
  const firstName = user?.user_metadata?.full_name?.split(' ')?.[0] || user?.email?.split('@')?.[0] || ''
  const initials = firstName?.[0]?.toUpperCase() || '?'

  if (!user) return <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center"><div className="text-sm text-[#8a7e6e]">Loading...</div></div>

  return (
    <div className="min-h-screen bg-[#f5f2ee]">
      <nav className="bg-white border-b border-[#e8e3dc] sticky top-0 z-50">
        <div className="flex items-center px-4 h-12">
          <Link href="/dashboard" className="flex items-center gap-1 mr-5 flex-shrink-0">
            <span className="font-bold text-[#1a1a2e] text-lg">Sen<span className="text-[#3b6bef]">tra</span></span>
          </Link>

          <div className="hidden md:flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-hide min-w-0">
            {navItems.map(item => {
              const Icon = item.icon
              const active = isActive(item.href)
              return (
                <Link key={item.href} href={item.href}
                  className={"flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors font-medium " +
                    (active ? 'bg-[#eef1fd] text-[#3b6bef]' : 'text-[#4a4a5a] hover:bg-[#f0ece6]')}>
                  <Icon size={13} strokeWidth={active ? 2.5 : 2} />
                  <span className="hidden lg:inline">{item.label}</span>
                </Link>
              )
            })}
          </div>

          <div className="hidden md:flex items-center gap-2 ml-3 flex-shrink-0">
            {role === 'owner' && (
              <Link href="/dashboard/admin"
                className={"text-xs px-2 py-1 rounded-lg font-semibold " + (pathname.startsWith('/dashboard/admin') ? 'bg-purple-100 text-purple-700' : 'text-purple-600 hover:bg-purple-50')}>
                ♦ Admin
              </Link>
            )}
            <TrialBadge />
            <div className="flex items-center gap-1.5 text-xs text-[#8a7e6e] bg-[#f0ece6] px-2.5 py-1.5 rounded-lg whitespace-nowrap">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="#8a7e6e" strokeWidth="1.2"/><path d="M6 3.5v2.5l1.5 1.5" stroke="#8a7e6e" strokeWidth="1.2" strokeLinecap="round"/></svg>
              {ws?.credits || 100} / 100
            </div>
            <div ref={avatarRef} className="relative flex items-center gap-1.5 cursor-pointer" onClick={() => setAvatarOpen(!avatarOpen)}>
              <div className="w-7 h-7 rounded-full bg-[#3b6bef] flex items-center justify-center text-white text-xs font-bold">
                {initials}
              </div>
              <span className="text-sm font-medium text-[#1a1a2e] hidden lg:inline">{firstName}</span>
              {avatarOpen && (
                <div className="absolute right-0 top-9 w-52 bg-white border border-[#e8e3dc] rounded-xl shadow-lg overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-[#f0ece6]">
                    <div className="text-xs font-medium text-[#1a1a2e]">{firstName}</div>
                    <div className="text-xs text-[#8a7e6e] truncate">{user?.email}</div>
                  </div>
                  <Link href="/dashboard/settings" onClick={() => setAvatarOpen(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#1a1a2e] hover:bg-[#f7f4f0]">
                    <Settings size={14} /> Settings
                  </Link>
                  {role === 'owner' && (
                    <Link href="/dashboard/admin" onClick={() => setAvatarOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-purple-600 font-medium hover:bg-purple-50">
                      ♦ Admin <span className="text-xs bg-purple-100 px-1.5 py-0.5 rounded ml-auto">ADMIN</span>
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
            <div className="px-4 py-3 border-b border-[#f0ece6] flex items-center justify-between">
              <TrialBadge />
              <div className="flex items-center gap-1.5 text-xs text-[#8a7e6e] bg-[#f0ece6] px-2.5 py-1.5 rounded-lg">
                {ws?.credits || 100} / 100 credits
              </div>
            </div>
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

      {/* Trial expiry banner (3 days or less) */}
      {billingData && !billingData.blocked && billingData.status === 'trialing' && billingData.daysRemaining <= 3 && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 flex items-center justify-between gap-4">
          <p className="text-sm text-amber-800 font-medium">
            ⚠ Your trial ends in {billingData.daysRemaining} day{billingData.daysRemaining !== 1 ? 's' : ''}.
            Add a payment method to keep access.
          </p>
          <Link href="/dashboard/billing" className="text-xs font-bold text-amber-700 underline whitespace-nowrap">
            Upgrade now →
          </Link>
        </div>
      )}

      {/* Trial expired overlay */}
      {billingData?.blocked && pathname !== '/dashboard/billing' && pathname !== '/dashboard/settings' && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 text-center">
            <div className="text-4xl mb-4">🔒</div>
            <h2 className="text-xl font-bold text-[#1a1a2e] mb-2">Your trial has ended</h2>
            <p className="text-sm text-[#6b5e4e] mb-6 leading-relaxed">
              Upgrade to continue sending campaigns, generating briefs, and booking meetings.
              Your data is safe — nothing is deleted.
            </p>
            <div className="flex flex-col gap-2">
              <Link href="/dashboard/billing"
                className="w-full bg-[#3b6bef] hover:bg-[#2a5bdf] text-white rounded-xl py-3 text-sm font-semibold transition-colors">
                Upgrade now →
              </Link>
              <Link href="/dashboard/settings"
                className="w-full border border-[#e8e3dc] text-[#6b5e4e] rounded-xl py-3 text-sm transition-colors hover:bg-[#f5f2ee]">
                Account settings
              </Link>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-6">
        {children}
      </main>
    </div>
  )
}
