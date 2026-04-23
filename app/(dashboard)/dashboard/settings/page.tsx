'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null)
  const [workspaceId, setWorkspaceId] = useState<string|null>(null)
  const [workspace, setWorkspace] = useState<any>(null)
  const [campaignCount, setCampaignCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [briefEnabled, setBriefEnabled] = useState(true)
  const [briefTime, setBriefTime] = useState('07:30')
  const [briefTz, setBriefTz] = useState('Eastern Time (ET)')
  const [form, setForm] = useState({ name: '', company_name: '', sender_name: '', industry: '', company_size: '1-10', product_description: '', value_proposition: '', tone: 'professional', pain_points: '' })

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      setUser(session.user)
      const { data: member } = await supabase.from('workspace_members').select('workspace_id, role, workspaces(name, plan, credits, seats_limit)').eq('user_id', session.user.id).single()
      if (!member) return
      setWorkspaceId(member.workspace_id)
      setWorkspace(member)
      const { data: p } = await supabase.from('workspace_profiles').select('*').eq('workspace_id', member.workspace_id).single()
      const { count } = await supabase.from('campaigns').select('*', { count: 'exact', head: true }).eq('workspace_id', member.workspace_id)
      setCampaignCount(count || 0)
      if (p) setForm({ name: session.user.user_metadata?.full_name || '', company_name: p.company_name || '', sender_name: p.sender_name || '', industry: p.icp_industries?.[0] || '', company_size: p.icp_company_size || '1-10', product_description: p.product_description || '', value_proposition: p.value_proposition || '', tone: p.tone || 'professional', pain_points: p.pain_points || '' })
    })
  }, [])

  async function save() {
    setSaving(true)
    await fetch('/api/workspace/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: workspaceId, company_name: form.company_name, sender_name: form.sender_name, product_description: form.product_description, value_proposition: form.value_proposition, tone: form.tone, icp_company_size: form.company_size, icp_industries: [form.industry], pain_points: form.pain_points }) })
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  const ws = (workspace?.workspaces as any)
  const tones = ['Professional', 'Casual', 'Direct', 'Friendly', 'Witty']
  const timezones = ['Eastern Time (ET)', 'Central Time (CT)', 'Mountain Time (MT)', 'Pacific Time (PT)', 'GMT', 'CET', 'IST']

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1a1a2e]">Settings</h1>
        <p className="text-sm text-[#8a7e6e]">Account & company profile</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">ACCOUNT</div>
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-[#f0ece6]">
            <span className="text-sm text-[#6b5e4e] truncate">{user?.email}</span>
            <span className="text-xs bg-[#f0ece6] text-[#8a7e6e] px-2 py-1 rounded ml-2">email</span>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">Your name</label>
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="Your name" />
          </div>
        </div>

        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">PLAN</div>
          <div className="bg-[#eef1fd] border border-[#dde6fd] rounded-xl p-4 mb-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-[#3b6bef]">{ws?.plan === 'trial' ? 'Free Trial' : ws?.plan}</div>
                <div className="text-xs text-[#6b5e4e]">14 days free · no credit card required</div>
              </div>
              <button className="bg-[#3b6bef] text-white text-xs px-3 py-1.5 rounded-lg font-medium">Upgrade →</button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-[#f7f4f0] rounded-lg p-2">
              <div className="text-lg font-bold text-[#1a1a2e]">{campaignCount}</div>
              <div className="text-xs text-[#8a7e6e]">Campaigns</div>
            </div>
            <div className="bg-[#f7f4f0] rounded-lg p-2">
              <div className="text-lg font-bold text-[#1a1a2e]">{ws?.credits || 0}</div>
              <div className="text-xs text-[#8a7e6e]">Credits</div>
            </div>
            <div className="bg-[#f7f4f0] rounded-lg p-2">
              <div className="text-lg font-bold text-[#1a1a2e]">{new Date(user?.created_at || '').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
              <div className="text-xs text-[#8a7e6e]">Member Since</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">COMPANY</div>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Company name *</label>
              <input value={form.company_name} onChange={e => setForm({...form, company_name: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Sender name <span className="text-[#b0a898] font-normal">OPTIONAL</span></label>
              <input value={form.sender_name} onChange={e => setForm({...form, sender_name: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Industry <span className="text-[#b0a898] font-normal">OPTIONAL</span></label>
                <input value={form.industry} onChange={e => setForm({...form, industry: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="e.g. SaaS" />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Company size</label>
                <select value={form.company_size} onChange={e => setForm({...form, company_size: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]">
                  {['1-10','11-50','51-200','201-1000','1000+'].map(s => <option key={s}>{s} employees</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">PRODUCT & AUDIENCE</div>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Product description *</label>
              <textarea value={form.product_description} onChange={e => setForm({...form, product_description: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" rows={2} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Value proposition <span className="text-[#b0a898] font-normal">OPTIONAL</span></label>
              <textarea value={form.value_proposition} onChange={e => setForm({...form, value_proposition: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" rows={2} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] mb-2 block">Email tone</label>
              <div className="flex flex-wrap gap-2">
                {tones.map(t => (
                  <button key={t} onClick={() => setForm({...form, tone: t.toLowerCase()})}
                    className={"px-3 py-1.5 rounded-lg text-sm border transition-colors " + (form.tone === t.toLowerCase() ? 'bg-[#3b6bef] text-white border-[#3b6bef]' : 'border-[#e8e3dc] text-[#6b5e4e]')}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Pain points / Buying signals <span className="text-[#b0a898] font-normal">OPTIONAL</span></label>
              <textarea value={form.pain_points} onChange={e => setForm({...form, pain_points: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" rows={2} />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-1">PROSPECT RESEARCH</div>
        <p className="text-xs text-[#8a7e6e] mb-3">Your monthly prospect research credits.</p>
        <div className="border border-[#e8e3dc] rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 bg-[#3b6bef] rounded-lg flex items-center justify-center text-white text-sm">🔍</div>
            <div>
              <div className="text-sm font-semibold text-[#1a1a2e]">Prospect Credits</div>
              <div className="text-xs text-[#8a7e6e]">0 / 100 prospect credits used this month</div>
            </div>
          </div>
          <div className="w-full bg-[#f0ece6] rounded-full h-1.5 mb-1">
            <div className="bg-[#3b6bef] h-1.5 rounded-full" style={{ width: '0%' }}></div>
          </div>
          <div className="text-xs text-[#8a7e6e]">Starter plan · 100 credits remaining</div>
        </div>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <span>☕</span>
          <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider">MORNING COFFEE BRIEF</div>
        </div>
        <p className="text-xs text-[#8a7e6e] mb-4">Receive a daily AI-researched email with meeting prep or market intelligence.</p>
        <div className="flex items-center justify-between mb-4 p-3 border border-[#e8e3dc] rounded-xl">
          <div>
            <div className="text-sm font-semibold text-[#1a1a2e]">Enable Morning Brief</div>
            <div className="text-xs text-[#8a7e6e]">Daily AI brief delivered to your inbox each weekday</div>
          </div>
          <button onClick={() => setBriefEnabled(!briefEnabled)}
            className={"w-11 h-6 rounded-full transition-colors relative " + (briefEnabled ? 'bg-[#3b6bef]' : 'bg-[#e8e3dc]')}>
            <div className={"w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all " + (briefEnabled ? 'right-0.5' : 'left-0.5')}></div>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">DELIVERY TIME</label>
            <input type="time" value={briefTime} onChange={e => setBriefTime(e.target.value)} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">YOUR TIMEZONE</label>
            <select value={briefTz} onChange={e => setBriefTz(e.target.value)} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]">
              {timezones.map(tz => <option key={tz}>{tz}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-[#f7f4f0] rounded-xl p-3">
            <div className="text-sm font-semibold text-[#1a1a2e] mb-1">📅 Meeting Days</div>
            <div className="text-xs text-[#8a7e6e]">AI-researched prospect profiles, talking points & discovery questions</div>
          </div>
          <div className="bg-[#f7f4f0] rounded-xl p-3">
            <div className="text-sm font-semibold text-[#1a1a2e] mb-1">📊 No-Meeting Days</div>
            <div className="text-xs text-[#8a7e6e]">Market trends, competitor intel & 3 new campaign suggestions</div>
          </div>
        </div>
        <a href="/dashboard/morning-brief" className="text-xs border border-[#e8e3dc] px-3 py-2 rounded-lg text-[#6b5e4e] inline-flex items-center gap-1">☕ Send me today's brief now</a>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">BILLING & PAYMENT</div>
        <div className="border border-[#e8e3dc] rounded-xl p-4 mb-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm font-semibold text-[#1a1a2e]">Current Plan</div>
              <div className="text-sm text-[#6b5e4e]">{ws?.plan === 'trial' ? 'Free Trial' : ws?.plan}</div>
            </div>
            <button className="bg-[#3b6bef] text-white text-xs px-3 py-1.5 rounded-lg font-medium">Change plan →</button>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-[#f0ece6]">
            <div><div className="text-xs text-[#8a7e6e] uppercase tracking-wider">NEXT BILLING DATE</div><div className="text-sm text-[#1a1a2e] mt-1">—</div></div>
            <div><div className="text-xs text-[#8a7e6e] uppercase tracking-wider">BILLING STATUS</div><div className="text-sm text-[#1a1a2e] mt-1">Active</div></div>
          </div>
        </div>
        <div className="border border-[#e8e3dc] rounded-xl p-4 mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-[#1a1a2e]">Payment Method</div>
            <div className="text-xs text-[#8a7e6e]">No payment method on file</div>
          </div>
          <button className="text-xs border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-[#6b5e4e]">Update →</button>
        </div>
        <div className="text-sm font-semibold text-[#1a1a2e] mb-2">Invoice History</div>
        <div className="text-center py-6 text-sm text-[#8a7e6e] border border-[#e8e3dc] rounded-xl">No invoices yet.</div>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">ADVANCED SETTINGS</div>
        {[
          { title: 'API Keys', desc: 'Programmatic access to your Sentra account' },
          { title: 'Mailbox Rotation', desc: 'Rotate between multiple sending mailboxes to maximize deliverability' },
          { title: 'GDPR & Compliance', desc: 'Configure opt-in requirements and consent tracking' },
          { title: 'Data Export', desc: 'Export your campaigns, contacts, and analytics data' },
        ].map(item => (
          <div key={item.title} className="flex items-center justify-between py-3 border-b border-[#f0ece6] last:border-0">
            <div>
              <div className="text-sm font-medium text-[#1a1a2e]">{item.title}</div>
              <div className="text-xs text-[#8a7e6e]">{item.desc}</div>
            </div>
            <span className="text-xs text-amber-500 font-medium">Coming soon</span>
          </div>
        ))}
      </div>

      <div className="bg-white border-2 border-red-100 rounded-xl p-5 mb-6">
        <div className="text-xs font-bold text-red-500 uppercase tracking-wider mb-4">DANGER ZONE</div>
        <div className="flex items-center justify-between py-2 border-b border-[#f0ece6]">
          <div>
            <div className="text-sm font-medium text-[#1a1a2e]">Change password</div>
            <div className="text-xs text-[#8a7e6e]">Update your login password</div>
          </div>
          <button className="text-sm border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-[#6b5e4e]">Change password</button>
        </div>
        <div className="flex items-center justify-between py-2 mt-2">
          <div>
            <div className="text-sm font-medium text-red-600">Delete account</div>
            <div className="text-xs text-[#8a7e6e]">Permanently delete your account and all data</div>
          </div>
          <button className="text-sm border border-red-200 text-red-500 px-3 py-1.5 rounded-lg">Delete account</button>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <button onClick={() => setForm({ name: '', company_name: '', sender_name: '', industry: '', company_size: '1-10', product_description: '', value_proposition: '', tone: 'professional', pain_points: '' })} className="text-sm text-[#8a7e6e]">Reset</button>
        <button onClick={save} disabled={saving} className="bg-[#3b6bef] text-white px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40">
          {saved ? '✓ Saved' : saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}