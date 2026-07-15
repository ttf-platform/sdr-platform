'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import type { Route } from 'next'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { readDashboardLocaleSync, writeDashboardLocale } from '@/lib/locale'
import { LayoutDashboard, Megaphone, Users, Mail, Calendar, TrendingUp, Settings, Sun, UserPlus, CreditCard, BarChart2, Globe, Shield, Radio, ListChecks } from 'lucide-react'
import TrialBadge from '@/components/TrialBadge'
import { getTrialStatus } from '@/lib/trial-status'
import { FloatingHelpButton } from '@/components/help-widget/FloatingHelpButton'
import { PostHogIdentify } from '@/components/PostHogIdentify'
import { WorkspaceDropdown } from '@/components/layout/WorkspaceDropdown'
import { InboxUnreadBadge } from '@/components/layout/InboxUnreadBadge'
import { Toaster } from 'sonner'
import { OnboardingProgressProvider, useOnboardingProgress } from '@/lib/hooks/useOnboardingProgress'
import { OnboardingProvider } from '@/components/onboarding/OnboardingProvider'
import { OnboardingChecklist } from '@/components/onboarding/OnboardingChecklist'
import { ResumeOnboardingButton } from '@/components/onboarding/ResumeOnboardingButton'
import { SampleDataBanner } from '@/components/onboarding/SampleDataBanner'
import { ReplayWelcomeMenuItem } from '@/components/onboarding/ReplayWelcomeMenuItem'
import { useWorkspace } from '@/lib/hooks/useWorkspace'

const supabase = createClient()

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const tNav = useTranslations('dashboard.nav')
  const tShell = useTranslations('dashboard.shell')
  // Session + workspace_members bootstrap is owned by WorkspaceProvider
  // (lib/hooks/useWorkspace). Consumers here just read.
  const { user, workspace } = useWorkspace()
  const [billingData, setBillingData] = useState<{ blocked: boolean; daysRemaining: number; status: string } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [isSentraAdmin, setIsSentraAdmin] = useState(false)
  // D2 lot 3 — non-blocking maintenance banner + widget kill switch.
  // Defaults fail SAFE: banner off, widget on, so any /api/settings/public-flags
  // fetch failure leaves the app fully functional.
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [widgetHelpEnabled, setWidgetHelpEnabled] = useState(true)
  const avatarRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

  useEffect(() => {
    let cancelled = false
    fetch('/api/settings/public-flags', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { maintenance_mode?: boolean; widget_help_enabled?: boolean } | null) => {
        if (cancelled || !data) return
        setMaintenanceMode(data.maintenance_mode === true)
        setWidgetHelpEnabled(data.widget_help_enabled !== false)
      })
      .catch(() => { /* fail-soft — keep defaults */ })
    return () => { cancelled = true }
  }, [])

  // Trial banner + admin flag + workspace_profiles locale sync. Runs when the
  // provider finishes bootstrapping (workspace becomes non-null) and re-runs
  // if the provider ever refetches. Redirects /login and /no-workspace are
  // owned by the provider — deliberately not duplicated here.
  useEffect(() => {
    if (!workspace) return
    const ws = workspace.workspaces as any
    const ts = getTrialStatus({ subscription_status: ws?.subscription_status, trial_end_date: ws?.trial_end_date })
    setBillingData({ blocked: ts.blockedActions, daysRemaining: ts.daysRemaining, status: ts.status })
    fetch('/api/admin/check').then(r => r.json()).then(d => { if (d?.isAdmin) setIsSentraAdmin(true) }).catch(() => {})

    // Sync the dashboard locale cookie against workspace_profiles.language.
    // If the DB language changed (e.g. admin flipped it, or a settings page
    // update landed) and diverges from the cookie posed at login, update
    // the cookie so the NEXT reload picks up the new locale. We deliberately
    // do NOT force a re-hydration of the current render — avoids a visible
    // EN↔FR flash mid-session. A hard refresh applies the change.
    supabase
      .from('workspace_profiles')
      .select('language')
      .eq('workspace_id', workspace.workspace_id)
      .maybeSingle()
      .then(({ data: profile }) => {
        const dbLang = profile?.language
        if (dbLang === 'en' || dbLang === 'fr') {
          if (readDashboardLocaleSync() !== dbLang) writeDashboardLocale(dbLang)
        }
      })
  }, [workspace])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setAvatarOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') { setMenuOpen(false); setAvatarOpen(false) }
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  // Nav items — labelKey references dashboard.nav.* i18n key.
  const navItems = [
    { href: '/dashboard',           labelKey: 'dashboard', icon: LayoutDashboard },
    { href: '/dashboard/campaigns', labelKey: 'campaigns', icon: Megaphone },
    { href: '/dashboard/signals',   labelKey: 'signals',   icon: Radio },
    { href: '/dashboard/inbox',     labelKey: 'inbox',     icon: Mail },
    { href: '/dashboard/prospects', labelKey: 'prospects', icon: Users },
    { href: '/dashboard/pipeline',  labelKey: 'pipeline',  icon: TrendingUp },
    { href: '/dashboard/meetings',  labelKey: 'meetings',  icon: Calendar },
  ]

  const isActive = (href: string) => href === '/dashboard' ? pathname === href : pathname.startsWith(href)
  const ws = (workspace?.workspaces as any)
  const planTier = ws?.plan_tier ?? 'starter'
  const hasLinkedIn = !!ws?.has_linkedin
  const firstName = user?.user_metadata?.full_name?.split(' ')?.[0] || user?.email?.split('@')?.[0] || ''
  const initials = firstName?.[0]?.toUpperCase() || '?'

  if (!user) return (
    <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center">
      <div className="text-sm text-[#8a7e6e]">{tShell('loading')}</div>
    </div>
  )

  return (
    <OnboardingProgressProvider>
    <div className="min-h-screen bg-[#f5f2ee]">
      <PostHogIdentify />

      {/* Top nav */}
      <nav aria-label="App navigation" className="bg-white border-b border-[#e8e3dc] sticky top-0 z-50">
        <div className="flex items-center px-4 h-12">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-1 mr-6 flex-shrink-0">
            <span className="font-bold text-[#1a1a2e] text-lg">Mir<span className="text-[#3b6bef]">vo</span></span>
          </Link>

          {/* Desktop nav — 6 entries */}
          <div className="hidden md:flex items-center gap-0.5 flex-1 min-w-0">
            {navItems.map(item => {
              const Icon = item.icon
              const active = isActive(item.href)
              const isInbox = item.href === '/dashboard/inbox'
              return (
                <Link key={item.href} href={item.href as never}
                  className={"flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors font-medium " +
                    (active ? 'bg-[#eef1fd] text-[#3b6bef]' : 'text-[#4a4a5a] hover:bg-[#f0ece6]')}>
                  <Icon size={13} strokeWidth={active ? 2.5 : 2} />
                  <span className="hidden lg:inline">{tNav(item.labelKey)}</span>
                  {isInbox && <InboxUnreadBadge />}
                </Link>
              )
            })}
          </div>

          {/* Desktop right side */}
          <div className="hidden md:flex items-center gap-2 ml-auto flex-shrink-0">
            <WorkspaceDropdown
              planTier={planTier}
              isMirvoAdmin={isSentraAdmin}
              hasLinkedIn={hasLinkedIn}
              pathname={pathname}
            />
            <TrialBadge />
            {/* Avatar */}
            <div ref={avatarRef} className="relative">
              <button
                className="flex items-center gap-1.5 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2"
                onClick={() => setAvatarOpen(!avatarOpen)}
                aria-label={tShell('accountMenu')}
                aria-haspopup="true"
                aria-expanded={avatarOpen}
              >
                <div className="w-7 h-7 rounded-full bg-[#3b6bef] flex items-center justify-center text-white text-xs font-bold">
                  {initials}
                </div>
                <span className="text-sm font-medium text-[#1a1a2e] hidden lg:inline">{firstName}</span>
              </button>
              {avatarOpen && (
                <div className="absolute right-0 top-9 w-52 bg-white border border-[#e8e3dc] rounded-xl shadow-lg overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-[#f0ece6]">
                    <div className="text-xs font-medium text-[#1a1a2e]">{firstName}</div>
                    <div className="text-xs text-[#8a7e6e] truncate">{user?.email}</div>
                  </div>
                  <Link href="/dashboard/settings" onClick={() => setAvatarOpen(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#1a1a2e] hover:bg-[#f7f4f0]">
                    <Settings size={14} /> {tShell('settings')}
                  </Link>
                  <ReplayWelcomeMenuItem onClick={() => setAvatarOpen(false)} />
                  <ShowChecklistMenuItem onClick={() => setAvatarOpen(false)} />
                  <div className="border-t border-[#f0ece6]">
                    <Link href={"/" as Route} onClick={() => setAvatarOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#6b5e4e] hover:bg-[#f7f4f0]">
                      ← {tShell('homepage')}
                    </Link>
                    <button type="button" onClick={signOut}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50">
                      ⏻ {tShell('signOut')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Mobile burger */}
          <button
            type="button"
            className="md:hidden ml-auto p-3 text-[#6b5e4e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2 rounded"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? tShell('closeMenu') : tShell('openMenu')}
            aria-expanded={menuOpen}
            aria-controls="mobile-drawer"
          >
            <span aria-hidden="true">☰</span>
          </button>
        </div>
      </nav>

      {/* Trial expiry banner */}
      {billingData && !billingData.blocked && billingData.status === 'trialing' && billingData.daysRemaining <= 3 && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 flex items-center justify-between gap-4">
          <p className="text-sm text-amber-800 font-medium">
            ⚠ {tShell('trialEndsBanner', { days: billingData.daysRemaining })}
          </p>
          <Link href="/dashboard/billing" className="text-xs font-bold text-amber-700 underline whitespace-nowrap">
            {tShell('upgradeNow')} →
          </Link>
        </div>
      )}

      {/* Trial expired overlay */}
      {billingData?.blocked && pathname !== '/dashboard/billing' && pathname !== '/dashboard/settings' && (
        <div className="fixed inset-0 z-[100] bg-[#1a1a1a]/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 text-center">
            <div className="text-4xl mb-4">🔒</div>
            <h2 className="text-xl font-bold text-[#1a1a2e] mb-2">{tShell('trialEndedTitle')}</h2>
            <p className="text-sm text-[#6b5e4e] mb-6 leading-relaxed">
              {tShell('trialEndedBody')}
            </p>
            <div className="flex flex-col gap-2">
              <Link href="/dashboard/billing"
                className="w-full bg-[#3b6bef] hover:bg-[#2a5bdf] text-white rounded-xl py-3 text-sm font-medium transition-colors">
                {tShell('upgradeNow')} →
              </Link>
              <Link href="/dashboard/settings"
                className="w-full border border-[#e8e3dc] text-[#6b5e4e] rounded-xl py-3 text-sm transition-colors hover:bg-[#f5f2ee]">
                {tShell('accountSettings')}
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Mobile drawer — always in DOM, CSS transform controls open/close */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#1a1a1a]/40 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div
        id="mobile-drawer"
        className={`fixed inset-y-0 left-0 z-50 w-[min(18rem,calc(100vw-2rem))] bg-white overflow-y-auto md:hidden shadow-xl flex flex-col transition-transform duration-300 ease-out ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 h-12 border-b border-[#e8e3dc] flex-shrink-0">
              <Link href="/dashboard" onClick={() => setMenuOpen(false)}>
                <span className="font-bold text-[#1a1a2e] text-lg">Mir<span className="text-[#3b6bef]">vo</span></span>
              </Link>
              <button type="button" onClick={() => setMenuOpen(false)} aria-label={tShell('closeMenu')} className="text-[#6b5e4e] p-1.5 text-lg leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] rounded"><span aria-hidden="true">✕</span></button>
            </div>

            {/* 6 main nav items */}
            <div className="py-2">
              {navItems.map(item => {
                const Icon = item.icon
                const isInbox = item.href === '/dashboard/inbox'
                return (
                  <Link key={item.href} href={item.href as never} onClick={() => setMenuOpen(false)}
                    className={"flex items-center gap-3 px-4 py-3 text-sm " +
                      (isActive(item.href) ? 'text-[#3b6bef] font-medium bg-[#eef1fd]' : 'text-[#4a4a5a] hover:bg-[#f5f2ee]')}>
                    <Icon size={16} /> {tNav(item.labelKey)}
                    {isInbox && <InboxUnreadBadge />}
                  </Link>
                )
              })}
            </div>

            <div className="border-t border-[#e8e3dc]" />

            {/* Workspace sections inline */}
            <div className="py-2">
              <p className="px-4 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-[#aaaaaa]">{tShell('sectionInsights')}</p>
              <Link href="/dashboard/analytics" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-[#1a1a1a] hover:bg-[#f5f2ee]">
                <BarChart2 size={16} /> {tShell('analytics')}
              </Link>
              <Link href="/dashboard/morning-brief" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-[#1a1a1a] hover:bg-[#f5f2ee]">
                <Sun size={16} /> {tShell('morningBrief')}
              </Link>

              {hasLinkedIn && (
                <>
                  <p className="px-4 pt-3 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-[#aaaaaa]">{tShell('sectionAddons')}</p>
                  <Link href={"/dashboard/linkedin" as never} onClick={() => setMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-[#1a1a1a] hover:bg-[#f5f2ee]">
                    <Globe size={16} /> {tShell('linkedin')}
                  </Link>
                </>
              )}

              <p className="px-4 pt-3 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-[#aaaaaa]">{tShell('sectionSetup')}</p>
              <Link href="/dashboard/settings" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-[#1a1a1a] hover:bg-[#f5f2ee]">
                <Settings size={16} /> {tShell('settings')}
              </Link>
              {planTier === 'team' && (
                <Link href="/dashboard/team" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-[#1a1a1a] hover:bg-[#f5f2ee]">
                  <UserPlus size={16} /> {tShell('team')}
                </Link>
              )}
              <Link href="/dashboard/billing" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-[#1a1a1a] hover:bg-[#f5f2ee]">
                <CreditCard size={16} /> {tShell('billing')}
              </Link>
              {isSentraAdmin && (
                <>
                  <p className="px-4 pt-3 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-[#aaaaaa]">{tShell('sectionMirvoStaff')}</p>
                  <Link href="/admin" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-[#3b6bef] font-medium hover:bg-[#f5f2ee]">
                    <Shield size={16} /> {tShell('mirvoAdmin')}
                  </Link>
                </>
              )}
            </div>

            <div className="border-t border-[#e8e3dc]" />

            {/* Profile / sign out */}
            <div className="py-2">
              <Link href={"/" as Route} onClick={() => setMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-[#6b5e4e] hover:bg-[#f5f2ee]">
                ← {tShell('homepage')}
              </Link>
              <button type="button" onClick={() => { setMenuOpen(false); signOut() }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-500 hover:bg-red-50">
                ⏻ {tShell('signOut')}
              </button>
            </div>

            {/* Trial badge at bottom */}
            <div className="mt-auto border-t border-[#e8e3dc] px-4 py-3">
              <TrialBadge />
            </div>
          </div>

      {maintenanceMode && (
        <div
          role="status"
          aria-live="polite"
          className="border-b border-red-200 bg-red-50 text-red-800 text-sm px-4 py-2 text-center"
        >
          {tShell('maintenanceBanner')}
        </div>
      )}

      <SampleDataBanner />

      <main className="max-w-7xl mx-auto px-6 py-6">
        {children}
      </main>

      {widgetHelpEnabled && <FloatingHelpButton />}
      <OnboardingProvider />
      <OnboardingChecklist />
      <ResumeOnboardingButton />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#ffffff',
            border: '1px solid #e8e3dc',
            color: '#1a1a2e',
            borderRadius: '8px',
            fontSize: '14px',
          },
        }}
      />
    </div>
    </OnboardingProgressProvider>
  )
}

// Kept colocated so DashboardShell owns its avatar menu content without
// scattering one-liners across /components/onboarding. Only renders when
// the checklist has been dismissed, since the checklist is otherwise already
// visible on-screen.
function ShowChecklistMenuItem({ onClick }: { onClick?: () => void }) {
  const t = useTranslations('components.onboarding.menu')
  const { data, resumeChecklist } = useOnboardingProgress()
  if (!data?.stored?.checklist_dismissed) return null

  async function handleClick() {
    onClick?.()
    await resumeChecklist()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[#1a1a1a] hover:bg-[#f7f4f0] focus-visible:outline-none focus-visible:bg-[#f7f4f0]"
    >
      <ListChecks size={14} /> {t('showChecklist')}
    </button>
  )
}
