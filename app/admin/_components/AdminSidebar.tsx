'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  LifeBuoy,
  TrendingUp,
  Settings,
  ScrollText,
  Activity,
  type LucideIcon,
} from 'lucide-react';
import { AdminStatusIndicator } from './AdminStatusIndicator';

type NavItem = { href: string; label: string; icon: LucideIcon; comingSoon?: boolean };

const NAV_ITEMS: NavItem[] = [
  { href: '/admin/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/operations', label: 'Operations', icon: Activity },
  { href: '/admin/support', label: 'Support Center', icon: LifeBuoy },
  { href: '/admin/analytics', label: 'Analytics', icon: TrendingUp },
  { href: '/admin/settings', label: 'Platform Settings', icon: Settings },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
];

export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-60 flex-col border-r border-[#e8e3dc] bg-white">
      <div className="border-b border-[#e8e3dc] px-5 py-4">
        <Link href="/admin" className="block">
          <div className="text-base font-semibold text-[#1a1a1a]">Mirvo Admin</div>
          <div className="mt-0.5 text-xs text-[#9a9a9a]">Platform back-office</div>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            const disabled = item.comingSoon;
            const Icon = item.icon;
            return (
              <li key={item.href}>
                {disabled ? (
                  <div className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-sm text-[#9a9a9a]" aria-disabled="true">
                    <span className="flex items-center gap-2"><Icon size={16} aria-hidden="true" /><span>{item.label}</span></span>
                    <span className="rounded-full border border-[#fde68a] bg-[#fef3c7] px-1.5 py-0.5 text-[10px] font-medium text-[#92400e]">Soon</span>
                  </div>
                ) : (
                  <Link href={item.href as Route} className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${active ? 'bg-[#eff6ff] font-medium text-[#2563eb]' : 'text-[#1a1a1a] hover:bg-[#f5f2ee]'}`}>
                    <Icon size={16} aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-[#e8e3dc] p-3 flex flex-col gap-0.5">
        <AdminStatusIndicator />
        <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[#4a4a5a] transition-colors hover:bg-[#f5f2ee] hover:text-[#1a1a1a]">
          <span aria-hidden="true">←</span><span>Back to app</span>
        </Link>
      </div>
    </aside>
  );
}
