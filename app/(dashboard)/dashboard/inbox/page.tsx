'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function InboxPage() {
  const [messages, setMessages] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [tab, setTab] = useState<'inbox'|'starred'|'archive'>('inbox')
  const [workspaceId, setWorkspaceId] = useState<string|null>(null)
  const [aiDraft, setAiDraft] = useState('')
  const [generatingDraft, setGeneratingDraft] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: member } = await supabase.from('workspace_members').select('workspace_id').eq('user_id', session.user.id).single()
      if (!member) return
      setWorkspaceId(member.workspace_id)
      const { data } = await supabase.from('inbox_messages').select('*').eq('workspace_id', member.workspace_id).order('received_at', { ascending: false })
      setMessages(data || [])
    })
  }, [])

  async function generateDraft() {
    if (!selected) return
    setGeneratingDraft(true)
    const res = await fetch('/api/inbox/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: selected }) }).then(r => r.json())
    setAiDraft(res.draft || '')
    setGeneratingDraft(false)
  }

  async function markRead(id: string) {
    await supabase.from('inbox_messages').update({ is_read: true }).eq('id', id)
    setMessages(prev => prev.map(m => m.id === id ? {...m, is_read: true} : m))
  }

  async function toggleStar(id: string, starred: boolean) {
    await supabase.from('inbox_messages').update({ is_starred: !starred }).eq('id', id)
    setMessages(prev => prev.map(m => m.id === id ? {...m, is_starred: !starred} : m))
  }

  async function archive(id: string) {
    await supabase.from('inbox_messages').update({ is_archived: true }).eq('id', id)
    setMessages(prev => prev.map(m => m.id === id ? {...m, is_archived: true} : m))
    if (selected?.id === id) setSelected(null)
  }

  const filtered = messages.filter(m => {
    if (tab === 'starred') return m.is_starred && !m.is_archived
    if (tab === 'archive') return m.is_archived
    return !m.is_archived
  })

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-[#1a1a2e]">Inbox</h1>
        <p className="text-sm text-[#8a7e6e]">Replies from prospects across all campaigns</p>
      </div>

      <div className="flex gap-1 mb-4 border border-[#e8e3dc] rounded-xl p-1 bg-white w-fit">
        {(['inbox','starred','archive'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={"px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors " + (tab === t ? 'bg-white shadow-sm text-[#1a1a2e] border border-[#e8e3dc]' : 'text-[#8a7e6e]')}>
            {t === 'starred' ? '⭐ Starred' : t === 'archive' ? 'Archive' : 'Inbox'}
          </button>
        ))}
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-4xl mb-3">📬</div>
            <div className="font-bold text-[#1a1a2e] mb-1">No messages</div>
            <div className="text-sm text-[#8a7e6e]">Replies from prospects will appear here.</div>
          </div>
        ) : filtered.map(m => (
          <div key={m.id} onClick={() => { setSelected(m); markRead(m.id); setAiDraft('') }}
            className={"flex items-start gap-3 px-4 py-3 border-b border-[#f0ece6] cursor-pointer hover:bg-[#faf8f5] " + (selected?.id === m.id ? 'bg-[#f7f8ff]' : '') + (!m.is_read ? 'font-medium' : '')}>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3b6bef] to-[#8b5cf6] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {m.from_name?.[0] || m.from_email?.[0] || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className={"text-sm " + (!m.is_read ? 'font-semibold text-[#1a1a2e]' : 'text-[#1a1a2e]')}>{m.from_name || m.from_email}</span>
                <span className="text-xs text-[#8a7e6e]">{new Date(m.received_at).toLocaleDateString()}</span>
              </div>
              {m.subject && <div className="text-xs text-[#6b5e4e] truncate">{m.subject}</div>}
              <div className="text-xs text-[#8a7e6e] truncate">{m.body?.slice(0, 80)}...</div>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mt-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="font-semibold text-[#1a1a2e]">{selected.from_name || selected.from_email}</div>
              <div className="text-xs text-[#8a7e6e]">{selected.from_email}</div>
              {selected.subject && <div className="text-sm text-[#6b5e4e] mt-1">{selected.subject}</div>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => toggleStar(selected.id, selected.is_starred)} className="text-lg">{selected.is_starred ? '⭐' : '☆'}</button>
              <button onClick={() => archive(selected.id)} className="text-xs border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-[#6b5e4e]">Archive</button>
            </div>
          </div>
          <div className="text-sm text-[#4a3f32] leading-relaxed mb-4 whitespace-pre-wrap">{selected.body}</div>
          <div className="border-t border-[#f0ece6] pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider">AI Draft Reply</span>
              <button onClick={generateDraft} disabled={generatingDraft} className="text-xs bg-[#3b6bef] text-white px-3 py-1.5 rounded-lg disabled:opacity-40">
                {generatingDraft ? 'Generating...' : '✨ Generate draft'}
              </button>
            </div>
            {aiDraft && (
              <textarea value={aiDraft} onChange={e => setAiDraft(e.target.value)}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none"
                rows={5} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}