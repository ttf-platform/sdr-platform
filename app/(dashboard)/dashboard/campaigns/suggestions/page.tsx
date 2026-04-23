'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function SuggestionsPage() {
  const [profile, setProfile] = useState<any>(null)
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [customIcp, setCustomIcp] = useState('')
  const [parsingIcp, setParsingIcp] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string|null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: member } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', session.user.id)
        .single()
      if (member) {
        setWorkspaceId(member.workspace_id)
        const { data } = await supabase
          .from('workspace_profiles')
          .select('*')
          .eq('workspace_id', member.workspace_id)
          .single()
        setProfile(data)
      }
    })
  }, [])

  async function getSuggestions(icpOverride?: string) {
    setLoading(true)
    setSuggestions([])
    const res = await fetch('/api/campaigns/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, icpOverride })
    }).then(r => r.json())
    setSuggestions(res.suggestions || [])
    setLoading(false)
  }

  async function parseIcp() {
    setParsingIcp(true)
    const res = await fetch('/api/icp/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: customIcp })
    }).then(r => r.json())
    if (res.icp) getSuggestions(customIcp)
    setParsingIcp(false)
  }

  function useSuggestion(s: any) {
    const params = new URLSearchParams({ name: s.name, icp: s.icp, hook: s.hook, tone: s.tone || 'professional' })
    window.location.href = '/dashboard/campaigns/new?' + params.toString()
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <a href="/dashboard/campaigns" className="text-xs text-[#8a7e6e] hover:text-[#1a1a2e] mb-3 inline-block">← Back to campaigns</a>
        <h1 className="text-xl font-bold text-[#1a1a2e]">AI Campaign Suggestions</h1>
        <p className="text-sm text-[#8a7e6e]">Claude analyzes your ICP and suggests high-converting campaign strategies.</p>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-5">
        <div className="text-xs font-bold uppercase tracking-wider text-[#3b6bef] mb-3">Your current ICP</div>
        <p className="text-sm text-[#4a3f32] mb-4">{profile?.icp_description || 'Not set yet'}</p>
        <button onClick={() => getSuggestions()} disabled={loading || !profile?.icp_description}
          className="bg-[#1a1a2e] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 flex items-center gap-2">
          {loading ? 'Generating...' : '✦ Generate suggestions'}
        </button>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-5">
        <div className="text-xs font-bold uppercase tracking-wider text-[#8a7e6e] mb-3">Try a different ICP</div>
        <textarea value={customIcp} onChange={e => setCustomIcp(e.target.value)}
          className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none mb-3"
          rows={3} placeholder="Describe a new target in plain language — e.g. CFOs at manufacturing companies with 200-1000 employees..." />
        <button onClick={parseIcp} disabled={parsingIcp || !customIcp}
          className="border border-[#3b6bef] text-[#3b6bef] px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
          {parsingIcp ? 'Parsing...' : '✦ Parse with AI & generate'}
        </button>
      </div>

      {loading && (
        <div className="text-center py-12 text-sm text-[#8a7e6e]">Claude is analyzing your ICP... up to 30 seconds</div>
      )}

      {suggestions.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="text-xs font-bold uppercase tracking-wider text-[#8a7e6e]">{suggestions.length} suggestions</div>
          {suggestions.map((s, i) => (
            <div key={i} className="bg-white border border-[#e8e3dc] rounded-xl p-5 hover:border-[#3b6bef] transition-colors">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <div className="text-sm font-bold text-[#1a1a2e] mb-1">{s.name}</div>
                  <div className="text-xs text-[#8a7e6e]">{s.icp}</div>
                </div>
                <span className="text-xs bg-[#eef1fd] text-[#3b6bef] px-2 py-1 rounded-full whitespace-nowrap capitalize">{s.tone}</span>
              </div>
              <p className="text-sm text-[#4a3f32] mb-4">{s.hook}</p>
              <button onClick={() => useSuggestion(s)}
                className="text-sm text-[#3b6bef] font-medium hover:underline">
                Use this suggestion →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}