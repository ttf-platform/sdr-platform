'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function CallRecordingPage() {
  const [recordings, setRecordings] = useState<any[]>([])
  const [prospects, setProspects] = useState<any[]>([])
  const [workspaceId, setWorkspaceId] = useState<string|null>(null)
  const [recording, setRecording] = useState(false)
  const [timer, setTimer] = useState(0)
  const [title, setTitle] = useState('')
  const [prospectId, setProspectId] = useState('')
  const [selected, setSelected] = useState<any>(null)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: member } = await supabase.from('workspace_members').select('workspace_id').eq('user_id', session.user.id).single()
      if (!member) return
      setWorkspaceId(member.workspace_id)
      const { data: prox } = await supabase.from('prospects').select('id, first_name, last_name, company').eq('workspace_id', member.workspace_id)
      setProspects(prox || [])
      const { data: recs } = await supabase.from('call_recordings').select('*').eq('workspace_id', member.workspace_id).order('created_at', { ascending: false })
      setRecordings(recs || [])
    })
  }, [])

  useEffect(() => {
    let interval: any
    if (recording) {
      interval = setInterval(() => setTimer(t => t + 1), 1000)
    } else {
      setTimer(0)
    }
    return () => clearInterval(interval)
  }, [recording])

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return m + ':' + (sec < 10 ? '0' : '') + sec
  }

  async function generateReport(rec: any) {
    setGenerating(true)
    setSelected(rec)
    await new Promise(r => setTimeout(r, 2000))
    const mockReport = {
      summary: 'The prospect showed interest in the product but raised concerns about pricing and implementation timeline.',
      objections: ['Price too high compared to current solution', 'Implementation timeline unclear', 'Need buy-in from IT team'],
      next_steps: ['Send detailed pricing proposal', 'Schedule technical demo with IT', 'Follow up in 3 days'],
      proposal: 'Following our conversation, I wanted to send you a summary of how Sentra can help your team achieve a 3x improvement in outbound efficiency...'
    }
    await supabase.from('call_recordings').update({ report: mockReport }).eq('id', rec.id)
    setRecordings(prev => prev.map(r => r.id === rec.id ? {...r, report: mockReport} : r))
    setSelected({...rec, report: mockReport})
    setGenerating(false)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1a1a2e]">Call Recording</h1>
        <p className="text-sm text-[#8a7e6e]">Record calls, get AI transcription and structured reports</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className={"w-16 h-16 rounded-full flex items-center justify-center cursor-pointer transition-all " + (recording ? 'bg-red-500 animate-pulse' : 'bg-[#3b6bef]')}
              onClick={() => setRecording(!recording)}>
              <span className="text-2xl">🎙</span>
            </div>
            <div>
              <div className="text-sm text-[#8a7e6e]">{recording ? 'Recording...' : 'Click to start recording your call'}</div>
              <div className="text-3xl font-bold text-[#1a1a2e] font-mono">{formatTime(timer)}</div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">CALL TITLE</label>
              <input value={title} onChange={e => setTitle(e.target.value)}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
                placeholder="e.g. Discovery call with Acme Corp" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">LINK TO PROSPECT (OPTIONAL)</label>
              <select value={prospectId} onChange={e => setProspectId(e.target.value)}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]">
                <option value="">— Select prospect —</option>
                {prospects.map(p => (
                  <option key={p.id} value={p.id}>{p.first_name} {p.last_name} · {p.company}</option>
                ))}
              </select>
            </div>
            {!recording && (
              <div className="text-xs text-[#8a7e6e] flex items-center gap-1">🎤 Microphone permission required</div>
            )}
          </div>
        </div>

        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-sm font-semibold text-[#1a1a2e] mb-3 flex items-center gap-2">
            ✨ What you get after each call
          </div>
          <div className="flex flex-col gap-3">
            {[
              { icon: '🎙', title: 'Recording', desc: 'Full call saved securely' },
              { icon: '📝', title: 'AI Transcription', desc: 'Generated in 45 seconds' },
              { icon: '📋', title: 'Structured report', desc: 'Objections · Needs · Next steps' },
              { icon: '📄', title: 'Commercial proposal', desc: 'Ready to send to prospect' },
            ].map(item => (
              <div key={item.title} className="flex items-center gap-3 p-3 bg-[#f7f4f0] rounded-lg">
                <span className="text-xl">{item.icon}</span>
                <div>
                  <div className="text-sm font-medium text-[#1a1a2e]">{item.title}</div>
                  <div className="text-xs text-[#8a7e6e]">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden mb-4">
        <div className="px-5 py-4 border-b border-[#f0ece6] flex items-center gap-2">
          <span className="text-lg">📋</span>
          <div>
            <div className="font-semibold text-[#1a1a2e]">Call History</div>
            <span className="text-xs text-[#8a7e6e]">{recordings.length} calls</span>
          </div>
        </div>
        {recordings.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-4xl mb-3">📞</div>
            <div className="font-bold text-[#1a1a2e] mb-1">No recorded calls yet</div>
            <div className="text-sm text-[#8a7e6e]">Hit the microphone button to record your first sales call.</div>
          </div>
        ) : recordings.map(rec => (
          <div key={rec.id} className={"flex items-center justify-between px-5 py-3 border-b border-[#f7f4f0] cursor-pointer hover:bg-[#faf8f5] " + (selected?.id === rec.id ? 'bg-[#f7f8ff]' : '')}
            onClick={() => setSelected(rec)}>
            <div className="flex items-center gap-3">
              <span className="text-xl">🎙</span>
              <div>
                <div className="text-sm font-medium text-[#1a1a2e]">{rec.title || 'Untitled call'}</div>
                <div className="text-xs text-[#8a7e6e]">{new Date(rec.created_at).toLocaleDateString()} · {rec.duration ? Math.floor(rec.duration/60)+'min' : '—'}</div>
              </div>
            </div>
            <button onClick={e => { e.stopPropagation(); generateReport(rec) }}
              className="text-xs bg-[#3b6bef] text-white px-3 py-1.5 rounded-lg disabled:opacity-40"
              disabled={generating && selected?.id === rec.id}>
              {generating && selected?.id === rec.id ? 'Generating...' : rec.report ? 'View report' : '✨ Generate report'}
            </button>
          </div>
        ))}
      </div>

      {selected?.report && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-bold uppercase tracking-wider text-[#3b6bef] mb-4">AI CALL REPORT</div>
          <div className="mb-4">
            <div className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-2">Summary</div>
            <p className="text-sm text-[#4a3f32]">{selected.report.summary}</p>
          </div>
          <div className="mb-4">
            <div className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-2">Objections</div>
            {selected.report.objections?.map((o: string, i: number) => (
              <div key={i} className="text-sm text-[#4a3f32] flex items-start gap-2 mb-1"><span className="text-red-400">·</span>{o}</div>
            ))}
          </div>
          <div className="mb-4">
            <div className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-2">Next steps</div>
            {selected.report.next_steps?.map((s: string, i: number) => (
              <div key={i} className="text-sm text-[#4a3f32] flex items-start gap-2 mb-1"><span className="text-green-500">✓</span>{s}</div>
            ))}
          </div>
          <div>
            <div className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-2">Commercial proposal draft</div>
            <div className="bg-[#f7f4f0] rounded-xl p-4 text-sm text-[#4a3f32] leading-relaxed">{selected.report.proposal}</div>
          </div>
        </div>
      )}
    </div>
  )
}