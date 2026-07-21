'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  LifeBuoy,
  Mail,
  TrendingUp,
  Settings,
  ScrollText,
  Activity,
  Gauge,
  DollarSign,
  type LucideIcon,
} from 'lucide-react';
import { AdminStatusIndicator } from './AdminStatusIndicator';

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV_ITEMS: NavItem[] = [
  { href: '/admin/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/operations', label: 'Operations', icon: Activity },
  { href: '/admin/limits', label: 'Limits & spend', icon: Gauge },
  { href: '/admin/revenue', label: 'Revenue', icon: DollarSign },
  { href: '/admin/support', label: 'Support Center', icon: LifeBuoy },
  { href: '/admin/email-sequences', label: 'Email sequences', icon: Mail },
  { href: '/admin/analytics', label: 'Analytics', icon: TrendingUp },
  { href: '/admin/settings', label: 'Platform Settings', icon: Settings },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
];

// Shared nav renderer used by both the desktop <aside> and the mobile drawer.
// Keeps the active-state logic + tokens in a single spot so drawer/desktop
// can never drift.
function NavList({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <ul className="space-y-0.5">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + '/');
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href as Route}
              onClick={onNavigate}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${active ? 'bg-[#eff6ff] font-medium text-[#3b6bef]' : 'text-[#1a1a1a] hover:bg-[#f5f2ee]'}`}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AdminSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Esc closes the drawer. Same pattern as _DashboardShell.tsx.
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, []);

  return (
    <>
      {/* Desktop aside (unchanged behavior; only hidden on mobile) */}
      <aside className="hidden md:flex w-60 flex-col border-r border-[#e8e3dc] bg-white">
        <div className="border-b border-[#e8e3dc] px-5 py-4">
          <Link href="/admin" className="block">
            <div className="text-base font-semibold text-[#1a1a1a]">Mirvo Admin</div>
            <div className="mt-0.5 text-xs text-[#9a9a9a]">Platform back-office</div>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          <NavList pathname={pathname} />
        </nav>
        <div className="border-t border-[#e8e3dc] p-3 flex flex-col gap-0.5">
          <AdminStatusIndicator />
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[#4a4a5a] transition-colors hover:bg-[#f5f2ee] hover:text-[#1a1a1a]"
          >
            <span aria-hidden="true">←</span><span>Back to app</span>
          </Link>
        </div>
      </aside>

      {/* Mobile top bar (fixed, above content) */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 h-14 bg-white border-b border-[#e8e3dc] flex items-center justify-between px-4">
        <Link href="/admin" className="text-base font-semibold text-[#1a1a1a]">
          Mirvo Admin
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? 'Close admin menu' : 'Open admin menu'}
          aria-controls="admin-mobile-drawer"
          aria-expanded={mobileOpen}
          className="p-3 text-[#4a4a5a] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2"
        >
          <span aria-hidden="true">☰</span>
        </button>
      </div>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-[#1a1a1a]/40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer — always in DOM, CSS transform pilots the state */}
      <aside
        id="admin-mobile-drawer"
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-[min(18rem,calc(100vw-2rem))] bg-white overflow-y-auto shadow-xl flex flex-col transition-transform duration-300 ease-out ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="border-b border-[#e8e3dc] px-5 py-4 flex items-start justify-between gap-2">
          <Link href="/admin" onClick={() => setMobileOpen(false)} className="block">
            <div className="text-base font-semibold text-[#1a1a1a]">Mirvo Admin</div>
            <div className="mt-0.5 text-xs text-[#9a9a9a]">Platform back-office</div>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close admin menu"
            className="text-[#4a4a5a] p-1.5 text-lg leading-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef]"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          <NavList pathname={pathname} onNavigate={() => setMobileOpen(false)} />
        </nav>
        <div className="border-t border-[#e8e3dc] p-3 flex flex-col gap-0.5">
          <AdminStatusIndicator />
          <Link
            href="/dashboard"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[#4a4a5a] transition-colors hover:bg-[#f5f2ee] hover:text-[#1a1a1a]"
          >
            <span aria-hidden="true">←</span><span>Back to app</span>
          </Link>
        </div>
      </aside>
    </>
  );
}
