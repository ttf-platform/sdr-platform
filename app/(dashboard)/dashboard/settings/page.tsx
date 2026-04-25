'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ProfileQualityBadge from '@/components/ProfileQualityBadge'

const supabase = createClient()

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null)
  const [workspaceId, setWorkspaceId] = useState<string|null>(null)
  const [workspace, setWorkspace] = useState<any>(null)
  const [campaignCount, setCampaignCount] = useState(0)
  const [emailCount, setEmailCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [form, setForm] = useState({ name: '', company_name: '', sender_name: '', industry: '', company_size: '', product_description: '', icp_description: '', value_proposition: '', tone: 'professional', pain_points: '' })

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      setUser(session.user)
      const { data: member } = await supabase.from('workspace_members').select('workspace_id, role, workspaces(name, plan, credits, seats_limit)').eq('user_id', session.user.id).single()
      if (!member) return
      setWorkspaceId(member.workspace_id)
      setWorkspace(member)
      const { data: p } = await supabase.from('workspace_profiles').select('*').eq('workspace_id', member.workspace_id).single()
      const { count: cc } = await supabase.from('campaigns').select('*', { count: 'exact', head: true }).eq('workspace_id', member.workspace_id)
      const { data: camps } = await supabase.from('campaigns').select('sent_count').eq('workspace_id', member.workspace_id)
      setCampaignCount(cc || 0)
      setEmailCount(camps?.reduce((a, c) => a + (c.sent_count || 0), 0) || 0)
      if (p) setForm({ name: session.user.user_metadata?.full_name || '', company_name: p.company_name || '', sender_name: p.sender_name || '', industry: p.icp_industries?.[0] || '', company_size: p.icp_company_size || '', product_description: p.product_description || '', icp_description: p.icp_description || '', value_proposition: p.value_proposition || '', tone: p.tone || 'professional', pain_points: p.pain_points || '' })
      setProfileLoaded(true)
    })
  }, [])

  async function save() {
    setSaving(true)
    await fetch('/api/workspace/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: workspaceId, company_name: form.company_name, sender_name: form.sender_name, product_description: form.product_description, icp_description: form.icp_description, value_proposition: form.value_proposition, tone: form.tone, icp_company_size: form.company_size, icp_industries: form.industry ? [form.industry] : [], pain_points: form.pain_points }) })
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  const ws = (workspace?.workspaces as any)
  const tones = ['Professional', 'Casual', 'Direct', 'Friendly', 'Witty']
  const timezones = ['Eastern Time (ET)', 'Central Time (CT)', 'Mountain Time (MT)', 'Pacific Time (PT)', 'GMT', 'CET', 'IST']

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <div className="text-xs text-[#8a7e6e] mb-1"><a href="/dashboard" className="hover:text-[#1a1a2e]">Dashboard</a> / Settings</div>
        <h1 className="text-2xl font-bold text-[#1a1a2e]">Settings</h1>
        <p className="text-sm text-[#8a7e6e] mb-3">Account & company profile</p>
        {profileLoaded && <ProfileQualityBadge profile={{ product_description: form.product_description, icp_description: form.icp_description, sender_name: form.sender_name, value_proposition: form.value_proposition, icp_industries: form.industry ? [form.industry] : [], icp_company_size: form.company_size, pain_points: form.pain_points }} />}
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
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

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">PLAN</div>
        <div className="bg-[#eef1fd] border border-[#dde6fd] rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-[#3b6bef]">{ws?.plan === 'trial' ? 'Free Trial' : ws?.plan}</div>
              <div className="text-xs text-[#6b5e4e]">14 days free · no credit card required</div>
            </div>
            <button className="bg-[#3b6bef] text-white text-xs px-3 py-1.5 rounded-lg font-medium">Upgrade →</button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="border border-[#e8e3dc] rounded-xl p-3">
            <div className="text-xl font-bold text-[#1a1a2e]">{campaignCount}</div>
            <div className="text-xs text-[#8a7e6e] mt-1">Campaigns</div>
          </div>
          <div className="border border-[#e8e3dc] rounded-xl p-3">
            <div className="text-xl font-bold text-[#1a1a2e]">{emailCount}</div>
            <div className="text-xs text-[#8a7e6e] mt-1">Emails Sent</div>
          </div>
          <div className="border border-[#e8e3dc] rounded-xl p-3">
            <div className="text-xl font-bold text-[#1a1a2e]">{new Date(user?.created_at || '').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
            <div className="text-xs text-[#8a7e6e] mt-1">Member Since</div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">COMPANY</div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Company name *</label>
            <input value={form.company_name} onChange={e => setForm({...form, company_name: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs font-semibold text-[#6b5e4e]">Sender name</label>
              <span className="text-xs text-[#b0a898] bg-[#f5f2ee] px-1.5 py-0.5 rounded-full">Optional</span>
            </div>
            <input value={form.sender_name} onChange={e => setForm({...form, sender_name: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="text-xs font-semibold text-[#6b5e4e]">Industry</label>
                <span className="text-xs text-[#8a7e6e] bg-[#f0ece6] px-1.5 py-0.5 rounded-full">Adds 15% to AI quality</span>
              </div>
              <input value={form.industry} onChange={e => setForm({...form, industry: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="e.g. SaaS, Fintech" />
              <p className={`text-xs mt-1 ${form.industry ? 'text-green-600' : 'text-[#b0a898]'}`}>
                {form.industry ? '1 industry ✓' : '0/1 industry minimum'}
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="text-xs font-semibold text-[#6b5e4e]">Company size</label>
                <span className="text-xs text-[#8a7e6e] bg-[#f0ece6] px-1.5 py-0.5 rounded-full">Adds 10% to AI quality</span>
              </div>
              <select value={form.company_size} onChange={e => setForm({...form, company_size: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]">
                <option value="">Select...</option>
                {['1-10','11-50','51-200','201-1000','1000+'].map(s => <option key={s} value={s}>{s} employees</option>)}
              </select>
              <p className={`text-xs mt-1 ${form.company_size ? 'text-green-600' : 'text-[#b0a898]'}`}>
                {form.company_size ? 'Selected ✓' : 'Not selected'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">PRODUCT & AUDIENCE</div>
        <div className="flex flex-col gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs font-semibold text-[#6b5e4e]">Product description *</label>
              <span className="text-xs text-[#8a7e6e] bg-[#f0ece6] px-1.5 py-0.5 rounded-full">Adds 20% to AI quality</span>
            </div>
            <textarea value={form.product_description} onChange={e => setForm({...form, product_description: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" rows={3} />
            <p className={`text-xs mt-1 ${form.product_description.length >= 30 ? 'text-green-600' : 'text-[#b0a898]'}`}>
              {form.product_description.length}/30 chars{form.product_description.length >= 30 ? ' ✓' : ''}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs font-semibold text-[#6b5e4e]">Describe your ideal customer</label>
              <span className="text-xs text-[#b0a898]">ICP</span>
              <span className="text-xs text-[#8a7e6e] bg-[#f0ece6] px-1.5 py-0.5 rounded-full">Adds 25% to AI quality</span>
            </div>
            <textarea value={form.icp_description} onChange={e => setForm({...form, icp_description: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" rows={3} placeholder="e.g. VP Sales at B2B SaaS companies, 50-500 employees, Series A to C, struggling with outbound volume" />
            <p className={`text-xs mt-1 ${form.icp_description.length >= 30 ? 'text-green-600' : 'text-[#b0a898]'}`}>
              {form.icp_description.length}/30 chars{form.icp_description.length >= 30 ? ' ✓' : ''}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs font-semibold text-[#6b5e4e]">Value proposition</label>
              <span className="text-xs text-[#8a7e6e] bg-[#f0ece6] px-1.5 py-0.5 rounded-full">Adds 20% to AI quality</span>
            </div>
            <textarea value={form.value_proposition} onChange={e => setForm({...form, value_proposition: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" rows={2} />
            <p className={`text-xs mt-1 ${form.value_proposition.length >= 20 ? 'text-green-600' : 'text-[#b0a898]'}`}>
              {form.value_proposition.length}/20 chars{form.value_proposition.length >= 20 ? ' ✓' : ''}
            </p>
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
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs font-semibold text-[#6b5e4e]">Pain points / Buying signals</label>
              <span className="text-xs text-[#8a7e6e] bg-[#f0ece6] px-1.5 py-0.5 rounded-full">Adds 10% to AI quality</span>
            </div>
            <textarea value={form.pain_points} onChange={e => setForm({...form, pain_points: e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" rows={2} />
            <p className={`text-xs mt-1 ${form.pain_points.length >= 20 ? 'text-green-600' : 'text-[#b0a898]'}`}>
              {form.pain_points.length}/20 chars{form.pain_points.length >= 20 ? ' ✓' : ''}
            </p>
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
          <div className="w-full bg-[#f0ece6] rounded-full h-1.5 mb-1"><div className="bg-[#3b6bef] h-1.5 rounded-full" style={{ width: '0%' }}></div></div>
          <div className="text-xs text-[#8a7e6e]">Starter plan · 100 credits remaining</div>
        </div>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">BILLING & PAYMENT</div>
        <div className="border border-[#e8e3dc] rounded-xl p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <div><div className="text-sm font-semibold text-[#1a1a2e]">Current Plan</div><div className="text-sm text-[#6b5e4e]">{ws?.plan === 'trial' ? 'Free Trial' : ws?.plan}</div></div>
            <button className="bg-[#3b6bef] text-white text-xs px-3 py-1.5 rounded-lg font-medium">Change plan →</button>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-3 border-t border-[#f0ece6]">
            <div><div className="text-xs text-[#8a7e6e] uppercase tracking-wider">NEXT BILLING DATE</div><div className="text-sm text-[#1a1a2e] mt-1">—</div></div>
            <div><div className="text-xs text-[#8a7e6e] uppercase tracking-wider">BILLING STATUS</div><div className="text-sm text-[#1a1a2e] mt-1">Active</div></div>
          </div>
        </div>
        <div className="border border-[#e8e3dc] rounded-xl p-4 mb-3 flex items-center justify-between">
          <div><div className="text-sm font-semibold text-[#1a1a2e]">Payment Method</div><div className="text-xs text-[#8a7e6e]">No payment method on file</div></div>
          <button className="text-xs border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-[#6b5e4e]">Update →</button>
        </div>
        <div className="text-sm font-semibold text-[#1a1a2e] mb-2">Invoice History</div>
        <div className="text-center py-6 text-sm text-[#8a7e6e] border border-[#e8e3dc] rounded-xl">No invoices yet.</div>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">ADVANCED SETTINGS</div>
        {[
          { title: 'API Keys', desc: 'Programmatic access to your Sentra account' },
          { title: 'Mailbox Rotation', desc: 'Rotate between multiple sending mailboxes' },
          { title: 'GDPR & Compliance', desc: 'Configure opt-in requirements and consent tracking' },
          { title: 'Data Export', desc: 'Export your campaigns, contacts, and analytics data' },
        ].map(item => (
          <div key={item.title} className="flex items-center justify-between py-3 border-b border-[#f0ece6] last:border-0">
            <div><div className="text-sm font-medium text-[#1a1a2e]">{item.title}</div><div className="text-xs text-[#8a7e6e]">{item.desc}</div></div>
            <span className="text-xs text-amber-500 font-medium">Coming soon</span>
          </div>
        ))}
      </div>

      <div className="bg-white border-2 border-red-100 rounded-xl p-5 mb-6">
        <div className="text-xs font-bold text-red-500 uppercase tracking-wider mb-4">DANGER ZONE</div>
        <div className="flex items-center justify-between py-2 border-b border-[#f0ece6]">
          <div><div className="text-sm font-medium text-[#1a1a2e]">Change password</div><div className="text-xs text-[#8a7e6e]">Update your login password</div></div>
          <button className="text-sm border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-[#6b5e4e]">Change password</button>
        </div>
        <div className="flex items-center justify-between py-2 mt-2">
          <div><div className="text-sm font-medium text-red-600">Delete account</div><div className="text-xs text-[#8a7e6e]">Permanently delete your account and all data</div></div>
          <button className="text-sm border border-red-200 text-red-500 px-3 py-1.5 rounded-lg">Delete account</button>
        </div>
      </div>

      <div className="flex justify-between items-center mb-8">
        <button onClick={() => setForm({ name: '', company_name: '', sender_name: '', industry: '', company_size: '1-10', product_description: '', value_proposition: '', tone: 'professional', pain_points: '' })} className="text-sm text-[#8a7e6e]">Reset</button>
        <button onClick={save} disabled={saving} className="bg-[#3b6bef] text-white px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40">
          {saved ? '✓ Saved' : saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}