'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ProfileQualityBadge from '@/components/ProfileQualityBadge'
import { calculateProfileScore } from '@/lib/profile-quality'
import type { ProfileForScore } from '@/lib/profile-quality'

const supabase = createClient()

// Parses "YYYY-MM-DD" as a local date to avoid UTC boundary shift
function parseBriefDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function fmtBriefDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }).format(parseBriefDate(dateStr))
  } catch { return dateStr }
}

function fmtBriefDateShort(dateStr: string): string {
  if (!dateStr) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long', month: 'short', day: 'numeric',
    }).format(parseBriefDate(dateStr))
  } catch { return dateStr }
}

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    HIGH: 'bg-red-50 text-red-600',
    MED:  'bg-amber-50 text-amber-600',
    LOW:  'bg-slate-50 text-slate-500',
  }
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${styles[priority] ?? styles.LOW}`}>
      {priority}
    </span>
  )
}

function RichBrief({ content }: { content: any }) {
  const trends: any[]      = content.market_trends        ?? []
  const landscape: any[]   = content.competitive_landscape ?? []
  const campaigns: any[]   = content.campaign_ideas        ?? []

  return (
    <div className="flex flex-col gap-6">

      {/* ── Hero ── */}
      <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-xl px-6 py-8 text-center text-white">
        <div className="text-4xl mb-3">☕</div>
        <h2 className="text-2xl font-bold mb-1">Morning Coffee Brief</h2>
        <p className="text-emerald-100 text-sm mb-4">{fmtBriefDate(content.date)}</p>
        <span className="inline-block bg-white/20 text-white text-xs font-semibold px-3 py-1.5 rounded-full">
          📊 Market Intelligence Day
        </span>
      </div>

      {/* ── Greeting ── */}
      {(content.greeting || content.intro) && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl px-5 py-4">
          <p className="text-[#1a1a2e] text-sm leading-relaxed">
            {content.greeting && <span className="font-semibold">{content.greeting} </span>}
            {content.intro}
          </p>
        </div>
      )}

      {/* ── Today's Focus ── */}
      {content.today_focus && (
        <div className="bg-[#f4f1fb] border-l-4 border-[#8b5cf6] rounded-r-xl px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#8b5cf6] mb-1.5">⚡ Today's Focus</p>
          <p className="text-sm font-semibold text-[#1a1a2e] mb-1">{content.today_focus.title}</p>
          {content.today_focus.rationale && (
            <p className="text-xs text-[#6b5e8e]">{content.today_focus.rationale}</p>
          )}
        </div>
      )}

      {/* ── Market Trends ── */}
      {trends.length > 0 && (
        <div>
          <h3 className="text-base font-bold text-[#1a1a2e] mb-3">📈 Market Trends</h3>
          <div className="flex flex-col gap-3">
            {trends.map((t, i) => (
              <div key={i} className="bg-white border border-[#e8e3dc] rounded-xl p-5">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <p className="font-semibold text-sm text-[#1a1a2e] leading-tight">{t.title}</p>
                  <PriorityBadge priority={t.priority} />
                </div>
                <p className="text-sm text-[#4a4a5a] leading-relaxed">{t.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Competitive Landscape ── */}
      {landscape.length > 0 && (
        <div>
          <h3 className="text-base font-bold text-[#1a1a2e] mb-3">🎯 Competitive Landscape</h3>
          <div className="flex flex-col gap-3">
            {landscape.map((c, i) => (
              <div key={i} className="bg-green-50 border border-green-200 rounded-xl p-5">
                <p className="font-semibold text-sm text-green-700 mb-1">{c.competitor_type}</p>
                <p className="text-sm text-green-700 mb-3">{c.what_they_do}</p>
                <p className="text-sm font-semibold text-green-700">
                  <span className="mr-1">💡</span>{c.positioning_opportunity}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Campaign Ideas ── */}
      {campaigns.length > 0 && (
        <div>
          <h3 className="text-base font-bold text-[#1a1a2e] mb-0.5">🚀 Campaign Ideas</h3>
          <p className="text-xs text-[#8a7e6e] mb-3">AI-generated based on your ICP and current market signals</p>
          <div className="flex flex-col gap-4">
            {campaigns.map((idea, i) => {
              const launchUrl = `/dashboard/campaigns/new?${new URLSearchParams({
                name: idea.name,
                icp:  idea.target_persona ?? '',
                tone: 'professional',
              }).toString()}`
              return (
                <div key={i} className="bg-white border border-[#e8e3dc] rounded-xl p-5">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-xs font-semibold uppercase tracking-widest text-[#8b5cf6]">
                      Campaign Idea {i + 1}
                    </p>
                    {idea.estimated_contacts && (
                      <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full whitespace-nowrap">
                        ~{idea.estimated_contacts} contacts
                      </span>
                    )}
                  </div>
                  <p className="font-bold text-[#1a1a2e] text-base mb-4">{idea.name}</p>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7e6e] mb-1">Target Persona</p>
                      <p className="text-sm text-[#1a1a2e]">{idea.target_persona}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7e6e] mb-1">Angle</p>
                      <p className="text-sm text-[#1a1a2e]">{idea.angle}</p>
                    </div>
                  </div>

                  <div className="bg-[#f8fafc] rounded-lg px-4 py-3 mb-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7e6e] mb-1">Why Now?</p>
                    <p className="text-sm text-[#1a1a2e]">{idea.why_now}</p>
                  </div>

                  <a href={launchUrl}
                    className="block w-full text-center bg-[#3b6bef] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#2d57d4] transition-colors">
                    → Launch this campaign
                  </a>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <p className="text-center text-xs text-[#b0a898] pb-2">Generated by Sentra · Powered by AI</p>
    </div>
  )
}

function LegacyBrief({ content }: { content: any }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-gradient-to-r from-[#3b6bef] to-[#8b5cf6] px-5 py-4 rounded-xl">
        <div className="text-white font-bold text-lg">☕ Morning Coffee Brief</div>
      </div>
      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
        {content?.sections?.map((s: any, i: number) => (
          <div key={i} className="mb-4 pb-4 border-b border-[#f0ece6] last:border-0 last:mb-0 last:pb-0">
            <div className="text-xs font-bold uppercase tracking-wider text-[#3b6bef] mb-2">{s.title}</div>
            <p className="text-sm text-[#4a3f32] leading-relaxed">{s.content}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

const TIMEZONES = ['Eastern Time (ET)','Central Time (CT)','Mountain Time (MT)','Pacific Time (PT)','GMT','CET','IST']
const MIN_PROFILE_SCORE = 30

export default function MorningBriefPage() {
  const [briefs, setBriefs]           = useState<any[]>([])
  const [selected, setSelected]       = useState<any>(null)
  const [generating, setGenerating]   = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileForScore | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)

  // Morning Brief delivery settings (UI-only until Sprint 4 persistence)
  const [briefEnabled, setBriefEnabled] = useState(true)
  const [briefTime, setBriefTime]       = useState('07:30')
  const [briefTz, setBriefTz]           = useState('Eastern Time (ET)')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: member } = await supabase
        .from('workspace_members').select('workspace_id').eq('user_id', session.user.id).single()
      if (!member) return
      setWorkspaceId(member.workspace_id)

      const [{ data: wp }, { data: briefList }] = await Promise.all([
        supabase.from('workspace_profiles').select('product_description, icp_description, sender_name, value_proposition, icp_industries, icp_company_size, pain_points').eq('workspace_id', member.workspace_id).single(),
        supabase.from('morning_briefs').select('*').eq('workspace_id', member.workspace_id).order('brief_date', { ascending: false }),
      ])

      setProfile(wp ?? null)
      setProfileLoaded(true)
      setBriefs(briefList || [])
      if (briefList && briefList.length > 0) setSelected(briefList[0])
    })
  }, [])

  const profileGated = !profileLoaded || profile === null || calculateProfileScore(profile) < MIN_PROFILE_SCORE

  async function generateBrief() {
    if (!workspaceId || profileGated) return
    setGenerating(true)
    const res = await fetch('/api/morning-brief/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId }),
    }).then(r => r.json())
    if (res.brief) {
      setBriefs(prev => [res.brief, ...prev])
      setSelected(res.brief)
    }
    setGenerating(false)
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Morning Brief</h1>
          <p className="text-sm text-[#8a7e6e]">Your daily AI-powered outbound intelligence</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {briefs.length > 0 && (
            <button onClick={generateBrief} disabled={generating || profileGated}
              className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40">
              {generating ? 'Generating...' : "Today's brief"}
            </button>
          )}
          {profileLoaded && <ProfileQualityBadge profile={profile} className="items-end" />}
        </div>
      </div>

      {/* ── Delivery settings (Sprint 4 will wire persistence) ── */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-5">
        <div className="flex items-center gap-2 mb-1">
          <span>☕</span>
          <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider">Morning Coffee Brief</div>
        </div>
        <p className="text-xs text-[#8a7e6e] mb-4">Receive a daily AI-researched email with meeting prep or market intelligence.</p>
        <div className="flex items-center justify-between mb-4 p-3 border border-[#e8e3dc] rounded-xl">
          <div>
            <div className="text-sm font-semibold text-[#1a1a2e]">Enable Morning Brief</div>
            <div className="text-xs text-[#8a7e6e]">Daily AI brief delivered to your inbox each weekday</div>
          </div>
          <button onClick={() => setBriefEnabled(!briefEnabled)}
            className={`w-11 h-6 rounded-full transition-colors relative ${briefEnabled ? 'bg-[#3b6bef]' : 'bg-[#e8e3dc]'}`}>
            <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${briefEnabled ? 'right-0.5' : 'left-0.5'}`} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">Delivery Time</label>
            <input type="time" value={briefTime} onChange={e => setBriefTime(e.target.value)}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">Your Timezone</label>
            <select value={briefTz} onChange={e => setBriefTz(e.target.value)}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]">
              {TIMEZONES.map(tz => <option key={tz}>{tz}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#f7f4f0] rounded-xl p-3">
            <div className="text-sm font-semibold text-[#1a1a2e] mb-1">📅 Meeting Days</div>
            <div className="text-xs text-[#8a7e6e]">AI-researched prospect profiles, talking points & discovery questions</div>
          </div>
          <div className="bg-[#f7f4f0] rounded-xl p-3">
            <div className="text-sm font-semibold text-[#1a1a2e] mb-1">📊 No-Meeting Days</div>
            <div className="text-xs text-[#8a7e6e]">Market trends, competitor intel & 3 new campaign suggestions</div>
          </div>
        </div>
      </div>

      {/* ── Profile gating banner ── */}
      {profileLoaded && profileGated && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 text-sm text-amber-800">
          Add a more detailed company description to unlock Morning Brief —{' '}
          <a href="/dashboard/settings" className="font-semibold underline">Edit profile</a>
        </div>
      )}

      {briefs.length === 0 ? (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">☕</div>
          <h2 className="text-lg font-bold text-[#1a1a2e] mb-2">No briefs yet</h2>
          <p className="text-sm text-[#8a7e6e] mb-5">Generate your first morning brief to get AI-powered market insights and campaign ideas tailored to your ICP.</p>
          <button onClick={generateBrief} disabled={generating || profileGated}
            className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40">
            {generating ? 'Generating...' : 'Generate first brief'}
          </button>
          {generating && (
            <p className="text-xs text-[#8a7e6e] mt-3">This takes 5-15 seconds while Claude analyzes your ICP…</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Selected brief */}
          {selected && (
            selected.content?.mode === 'no_meetings'
              ? <RichBrief content={selected.content} />
              : <LegacyBrief content={selected.content} />
          )}

          {/* Archive */}
          <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f0ece6] flex items-center gap-2">
              <span className="text-lg">☕</span>
              <div>
                <div className="font-semibold text-[#1a1a2e]">Past Briefs</div>
                <div className="text-xs text-[#8a7e6e]">Your morning coffee brief archive</div>
              </div>
            </div>
            {briefs.map(b => (
              <div key={b.id} onClick={() => setSelected(b)}
                className={`flex items-center justify-between px-5 py-3 border-b border-[#f7f4f0] cursor-pointer hover:bg-[#faf8f5] last:border-0 ${selected?.id === b.id ? 'bg-[#f7f8ff]' : ''}`}>
                <div className="flex items-center gap-3">
                  <span className="text-xl">☕</span>
                  <div>
                    <div className="text-sm font-medium text-[#1a1a2e]">{fmtBriefDateShort(b.brief_date)}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-[#3b6bef] bg-[#eef1fd] px-1.5 py-0.5 rounded font-medium">
                        {b.content?.mode === 'no_meetings' ? 'Market Intel' : 'Brief'}
                      </span>
                    </div>
                  </div>
                </div>
                <button className="text-xs border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-[#6b5e4e]">View</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
