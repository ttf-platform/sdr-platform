'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { BarChart2, Sun, Globe, Users, CreditCard, ChevronDown, Shield } from 'lucide-react'

type Props = {
  planTier: string
  isMirvoAdmin: boolean
  hasLinkedIn: boolean
  pathname: string
}

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#aaaaaa' }}>
      {label}
    </p>
  )
}

function Divider() {
  return <div className="my-1 mx-3 border-t border-[#f0ece6]" />
}

type NavItemProps = {
  href: string
  icon: React.ElementType
  label: string
  color?: string
  active?: boolean
  onClose: () => void
}

function NavItem({ href, icon: Icon, label, color = '#1a1a1a', active, onClose }: NavItemProps) {
  return (
    <Link
      href={href as never}
      onClick={onClose}
      className={`flex items-center gap-2.5 mx-1.5 px-2.5 py-2 text-sm rounded-lg transition-colors ${active ? 'bg-[#eef1fd]' : 'hover:bg-[#f5f2ee]'}`}
      style={{ color: active ? '#3b6bef' : color }}
    >
      <Icon size={15} />
      {label}
    </Link>
  )
}

export function WorkspaceDropdown({ planTier, isMirvoAdmin, hasLinkedIn, pathname }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [])

  const hasAddOns = hasLinkedIn
  const close = () => setOpen(false)
  const isActive = (href: string) => pathname === href || (href !== '/dashboard' && pathname.startsWith(href))

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-medium text-[#4a4a5a] hover:bg-[#f0ece6] px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap"
      >
        Workspace
        <ChevronDown
          size={12}
          aria-hidden="true"
          style={{ transition: 'transform 0.15s ease', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 w-56 max-w-[calc(100vw-2rem)] bg-white border border-[#e8e3dc] rounded-xl shadow-lg z-50 overflow-hidden pb-1.5"
        >
          <SectionHeader label="Insights" />
          <NavItem href="/dashboard/analytics" icon={BarChart2} label="Analytics" active={isActive('/dashboard/analytics')} onClose={close} />
          <NavItem href="/dashboard/morning-brief" icon={Sun} label="Morning Brief" active={isActive('/dashboard/morning-brief')} onClose={close} />

          {hasAddOns && (
            <>
              <Divider />
              <SectionHeader label="Add-ons" />
              {hasLinkedIn && (
                <NavItem href={"/dashboard/linkedin" as never} icon={Globe} label="LinkedIn" active={isActive('/dashboard/linkedin')} onClose={close} />
              )}
            </>
          )}

          <Divider />
          <SectionHeader label="Workspace" />
          {planTier === 'team' && (
            <NavItem href="/dashboard/team" icon={Users} label="Team" active={isActive('/dashboard/team')} onClose={close} />
          )}
          <NavItem href="/dashboard/billing" icon={CreditCard} label="Billing" active={isActive('/dashboard/billing')} onClose={close} />

          {isMirvoAdmin && (
            <>
              <Divider />
              <SectionHeader label="Mirvo Staff" />
              <NavItem href="/admin" icon={Shield} label="Mirvo Admin" color="#3b6bef" active={isActive('/admin')} onClose={close} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
