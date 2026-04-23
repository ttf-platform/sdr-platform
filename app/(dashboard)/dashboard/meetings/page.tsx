'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function MeetingsPage() {
  const [user, setUser] = useState<any>(null)
  const [tab, setTab] = useState<'upcoming'|'all'|'cancelled'>('upcoming')
  const [view, setView] = useState<'list'|'calendar'>('list')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      setUser(session.user)
    })
  }, [])

  const bookingLink = user ? `https://sentra.app/book/${user.email?.split('@')[0]}` : ''

  function copyLink() {
    navigator.clipboard.writeText(bookingLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Meetings</h1>
          <p className="text-sm text-[#8a7e6e]">Upcoming meetings and your booking page setup</p>
        </div>
        <div className="flex gap-2">
          <button onClick={copyLink} className="border border-[#e8e3dc] bg-white text-[#1a1a2e] px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5">
            🔗 {copied ? 'Copied!' : 'Copy booking link'}
          </button>
          <button className="border border-[#3b6bef] text-[#3b6bef] px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5">
            ⚙ Scheduler settings
          </button>
        </div>
      </div>

      <div className="bg-[#eef1fd] border border-[#dde6fd] rounded-xl p-4 mb-5 flex items-start gap-3">
        <span className="text-xl">🔗</span>
        <div className="flex-1">
          <div className="text-sm font-semibold text-[#3b6bef] mb-1">Your booking link</div>
          <div className="text-sm text-[#6b5e4e] mb-2">{bookingLink}</div>
          <button onClick={copyLink} className="bg-[#3b6bef] text-white px-3 py-1.5 rounded-lg text-sm font-medium">
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <div className="flex gap-1 border border-[#e8e3dc] rounded-xl p-1 bg-white">
          <button onClick={() => setView('list')} className={"px-3 py-1.5 rounded-lg text-sm font-medium transition-colors " + (view === 'list' ? 'bg-white border border-[#e8e3dc] text-[#1a1a2e]' : 'text-[#8a7e6e]')}>
            📋 List
          </button>
          <button onClick={() => setView('calendar')} className={"px-3 py-1.5 rounded-lg text-sm font-medium transition-colors " + (view === 'calendar' ? 'bg-white border border-[#e8e3dc] text-[#1a1a2e]' : 'text-[#8a7e6e]')}>
            📅 Calendar
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-4 border border-[#e8e3dc] rounded-xl p-1 bg-white w-fit">
        {(['upcoming','all','cancelled'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={"px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors " + (tab === t ? 'bg-white border border-[#e8e3dc] text-[#3b6bef] font-semibold' : 'text-[#8a7e6e]')}>
            {t}
          </button>
        ))}
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center mb-5">
        <div className="text-4xl mb-3">📅</div>
        <div className="font-bold text-[#1a1a2e] mb-2">No upcoming meetings</div>
        <div className="text-sm text-[#8a7e6e] mb-4">Share your booking link and prospects will be able to schedule meetings with you.</div>
        <button onClick={copyLink} className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold">
          {copied ? '✓ Copied!' : 'Copy booking link'}
        </button>
      </div>
    </div>
  )
}