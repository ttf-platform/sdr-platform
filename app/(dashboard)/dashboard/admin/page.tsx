'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function AdminPage() {
  const [stats, setStats] = useState({ users: 0, active: 0, campaigns: 0, emails: 0, opens: 0 })
  const [users, setUsers] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'users'|'broadcast'|'credits'>('users')
  const [broadcast, setBroadcast] = useState({ subject: '', body: '', target: 'all' })
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [creditForm, setCreditForm] = useState({ email: '', amount: 30, reason: '' })
  const [creditSaving, setCreditSaving] = useState(false)
  const [creditSaved, setCreditSaved] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const res = await fetch('/api/admin/stats').then(r => r.json())
      setStats(res.stats || {})
      setUsers(res.users || [])
    })
  }, [])

  async function sendBroadcast() {
    setSending(true)
    await fetch('/api/admin/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(broadcast) })
    setSent(true)
    setBroadcast({ subject: '', body: '', target: 'all' })
    setSending(false)
    setTimeout(() => setSent(false), 3000)
  }

  async function grantCredits() {
    setCreditSaving(true)
    await fetch('/api/admin/credits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creditForm) })
    setCreditSaved(true)
    setCreditForm({ email: '', amount: 30, reason: '' })
    setCreditSaving(false)
    setTimeout(() => setCreditSaved(false), 3000)
  }

  const filtered = users.filter(u => !search || u.email?.includes(search) || u.company?.includes(search))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1a1a2e]">Admin Dashboard</h1>
        <p className="text-sm text-[#8a7e6e]">User management and platform overview</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'TOTAL USERS', value: stats.users, color: 'text-[#3b6bef]' },
          { label: 'ACTIVE USERS', value: stats.active, color: 'text-green-600', sub: 'Last 7 days' },
          { label: 'TOTAL CAMPAIGNS', value: stats.campaigns, color: 'text-[#f59e0b]', sub: 'Across all users' },
          { label: 'EMAILS SENT', value: stats.emails, color: 'text-[#3b6bef]', sub: 'All-time' },
          { label: 'EMAILS OPENED', value: stats.opens, color: 'text-green-600', sub: stats.emails > 0 ? ((stats.opens/stats.emails)*100).toFixed(0)+'% open rate' : '' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-[#e8e3dc] rounded-xl p-4">
            <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-2">{s.label}</div>
            <div className={"text-3xl font-bold " + s.color}>{s.value}</div>
            {s.sub && <div className="text-xs text-[#8a7e6e] mt-1">{s.sub}</div>}
          </div>
        ))}
      </div>

      <div className="flex gap-1 mb-4 border border-[#e8e3dc] rounded-xl p-1 bg-white w-fit">
        {(['users','broadcast','credits'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={"px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors " + (tab === t ? 'bg-white border border-[#e8e3dc] text-[#1a1a2e] shadow-sm' : 'text-[#8a7e6e]')}>
            {t === 'broadcast' ? '📢 Broadcast' : t === 'credits' ? '💳 Credits' : '👥 Users'}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#f0ece6]">
            <input value={search} onChange={e => setSearch(e.target.value)}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
              placeholder="Search by name, email, or company..." />
          </div>
          <div className="px-5 py-2 border-b border-[#f0ece6] grid grid-cols-4 gap-4">
            {['NAME / EMAIL','COMPANY','JOINED','PLAN'].map(h => (
              <div key={h} className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">{h}</div>
            ))}
          </div>
          {filtered.map((u, i) => (
            <div key={i} className="px-5 py-3 border-b border-[#f7f4f0] grid grid-cols-4 gap-4 items-center">
              <div>
                <div className="text-sm font-medium text-[#1a1a2e]">{u.name || u.email?.split('@')[0]}</div>
                <div className="text-xs text-[#8a7e6e]">{u.email}</div>
              </div>
              <div className="text-sm text-[#1a1a2e]">{u.company || '—'}</div>
              <div className="text-sm text-[#8a7e6e]">{u.joined ? new Date(u.joined).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</div>
              <div><span className="text-xs bg-[#f0ece6] text-[#6b5e4e] px-2 py-0.5 rounded-full capitalize">{u.plan || 'trial'}</span></div>
            </div>
          ))}
        </div>
      )}

      {tab === 'broadcast' && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">SEND MESSAGE TO USERS</div>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">Target</label>
              <select value={broadcast.target} onChange={e => setBroadcast({...broadcast, target: e.target.value})}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]">
                <option value="all">All users</option>
                <option value="trial">Trial users only</option>
                <option value="paid">Paid users only</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">Subject</label>
              <input value={broadcast.subject} onChange={e => setBroadcast({...broadcast, subject: e.target.value})}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
                placeholder="Important update about Sentra..." />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">Message</label>
              <textarea value={broadcast.body} onChange={e => setBroadcast({...broadcast, body: e.target.value})}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none"
                rows={5} placeholder="We wanted to let you know..." />
            </div>
            <button onClick={sendBroadcast} disabled={sending || !broadcast.subject || !broadcast.body}
              className="bg-[#3b6bef] text-white px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40 w-fit">
              {sent ? '✓ Sent!' : sending ? 'Sending...' : '📢 Send to all users'}
            </button>
          </div>
        </div>
      )}

      {tab === 'credits' && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">GRANT FREE ACCESS / CREDITS</div>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">User email</label>
              <input value={creditForm.email} onChange={e => setCreditForm({...creditForm, email: e.target.value})}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
                placeholder="friend@company.com" type="email" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">Credits / days to grant</label>
              <input value={creditForm.amount} onChange={e => setCreditForm({...creditForm, amount: parseInt(e.target.value)})}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
                type="number" min="1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">Reason (optional)</label>
              <input value={creditForm.reason} onChange={e => setCreditForm({...creditForm, reason: e.target.value})}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
                placeholder="Friend, tester, bug compensation..." />
            </div>
            <button onClick={grantCredits} disabled={creditSaving || !creditForm.email}
              className="bg-[#3b6bef] text-white px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40 w-fit">
              {creditSaved ? '✓ Granted!' : creditSaving ? 'Saving...' : '💳 Grant credits'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}