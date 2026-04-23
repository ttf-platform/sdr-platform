'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function MorningBriefPage() {
  const [briefs, setBriefs] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [generating, setGenerating] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string|null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: member } = await supabase.from('workspace_members').select('workspace_id').eq('user_id', session.user.id).single()
      if (!member) return
      setWorkspaceId(member.workspace_id)
      const { data } = await supabase.from('morning_briefs')
        .select('*')
        .eq('workspace_id', member.workspace_id)
        .order('brief_date', { ascending: false })
      setBriefs(data || [])
      if (data && data.length > 0) setSelected(data[0])
    })
  }, [])

  async function generateBrief() {
    setGenerating(true)
    const res = await fetch('/api/morning-brief/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId })
    }).then(r => r.json())
    if (res.brief) {
      setBriefs(prev => [res.brief, ...prev])
      setSelected(res.brief)
    }
    setGenerating(false)
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="max-w-2xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Morning Brief</h1>
          <p className="text-sm text-[#8a7e6e]">Your daily AI-powered outbound intelligence</p>
        </div>
        <button onClick={generateBrief} disabled={generating}
          className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 flex items-center gap-2">
          {generating ? 'Generating...' : '☕ Send me today's brief'}
        </button>
      </div>

      {briefs.length === 0 ? (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">☕</div>
          <h2 className="text-lg font-bold text-[#1a1a2e] mb-2">No briefs yet</h2>
          <p className="text-sm text-[#8a7e6e] mb-4">Generate your first morning brief to get AI-powered insights on your pipeline.</p>
          <button onClick={generateBrief} disabled={generating} className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40">
            {generating ? 'Generating...' : '☕ Generate first brief'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {selected && (
            <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
              <div className="bg-gradient-to-r from-[#3b6bef] to-[#8b5cf6] px-5 py-4">
                <div className="text-white text-xs font-medium mb-1">{new Date(selected.brief_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
                <div className="text-white font-bold text-lg flex items-center gap-2">☕ Morning Coffee Brief</div>
              </div>
              <div className="p-5">
                {selected.content?.sections?.map((s: any, i: number) => (
                  <div key={i} className="mb-4 pb-4 border-b border-[#f0ece6] last:border-0 last:mb-0 last:pb-0">
                    <div className="text-xs font-bold uppercase tracking-wider text-[#3b6bef] mb-2">{s.title}</div>
                    <p className="text-sm text-[#4a3f32] leading-relaxed">{s.content}</p>
                  </div>
                )) || (
                  <p className="text-sm text-[#4a3f32] leading-relaxed">{typeof selected.content === 'string' ? selected.content : JSON.stringify(selected.content)}</p>
                )}
              </div>
            </div>
          )}

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
                className={"flex items-center justify-between px-5 py-3 border-b border-[#f7f4f0] cursor-pointer hover:bg-[#faf8f5] " + (selected?.id === b.id ? 'bg-[#f7f8ff]' : '')}>
                <div className="flex items-center gap-3">
                  <span className="text-xl">☕</span>
                  <div>
                    <div className="text-sm font-medium text-[#1a1a2e]">{new Date(b.brief_date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-[#3b6bef] bg-[#eef1fd] px-1.5 py-0.5 rounded font-medium">Market Intel</span>
                      <span className="text-xs text-[#8a7e6e]">{b.sent_at ? 'Sent' : 'Not sent'}</span>
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