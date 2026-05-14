'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ThreadItem } from '@/app/api/inbox/messages/[id]/thread/route'

const supabase = createClient()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SentimentLabel =
  | 'positive'
  | 'neutral'
  | 'negative'
  | 'meeting_request'
  | 'unsubscribe'
  | 'bounce'

interface InboxMessage {
  id: string
  workspace_id: string
  thread_id: string | null
  prospect_email_id: string | null
  from_name: string | null
  from_email: string
  to_email: string
  subject: string | null
  body: string | null
  body_preview: string | null
  provider: string | null
  is_read: boolean
  is_starred: boolean
  is_archived: boolean
  sentiment: SentimentLabel | null
  sentiment_confidence: number | null
  received_at: string
}

type TabKey = 'all' | 'unread' | 'starred' | 'archived'

// ---------------------------------------------------------------------------
// Sentiment badge
// ---------------------------------------------------------------------------

const SENTIMENT_CONFIG: Record<
  SentimentLabel,
  { label: string; className: string }
> = {
  positive: {
    label: 'Interested',
    className: 'bg-green-50 text-green-700 border border-green-200',
  },
  meeting_request: {
    label: 'Meeting request',
    className: 'bg-blue-50 text-blue-700 border border-blue-200',
  },
  neutral: {
    label: 'Neutral',
    className: 'bg-zinc-50 text-zinc-600 border border-zinc-200',
  },
  negative: {
    label: 'Not interested',
    className: 'bg-red-50 text-red-600 border border-red-200',
  },
  unsubscribe: {
    label: 'Unsubscribe',
    className: 'bg-amber-50 text-amber-700 border border-amber-200',
  },
  bounce: {
    label: 'Bounce',
    className: 'bg-slate-50 text-slate-500 border border-slate-200',
  },
}

function SentimentBadge({ sentiment }: { sentiment: SentimentLabel | null }) {
  if (!sentiment) return null
  const cfg = SENTIMENT_CONFIG[sentiment]
  if (!cfg) return null
  return (
    <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-md ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: 'short' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(' ')
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
  }
  return email[0].toUpperCase()
}

// ---------------------------------------------------------------------------
// Thread view
// ---------------------------------------------------------------------------

function ThreadView({ items }: { items: ThreadItem[] }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {items.map(item => (
        <div
          key={item.id}
          className={`flex ${item.kind === 'sent' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
              item.kind === 'sent'
                ? 'bg-[#3b6bef] text-white'
                : 'bg-white border border-[#e8e3dc] text-[#4a3f32]'
            }`}
          >
            <p className="whitespace-pre-wrap">{item.body}</p>
            <p
              className={`text-[10px] mt-1.5 ${
                item.kind === 'sent' ? 'text-blue-200' : 'text-[#b0a49a]'
              }`}
            >
              {item.from_name || item.from_email} · {formatTimestamp(item.timestamp)}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'starred', label: 'Starred' },
  { key: 'archived', label: 'Archived' },
]

export default function InboxPage() {
  const [messages, setMessages] = useState<InboxMessage[]>([])
  const [selected, setSelected] = useState<InboxMessage | null>(null)
  const [tab, setTab] = useState<TabKey>('all')
  const [thread, setThread] = useState<ThreadItem[] | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [aiDraft, setAiDraft] = useState('')
  const [generatingDraft, setGeneratingDraft] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Load messages ──────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const { data: member } = await supabase
          .from('workspace_members')
          .select('workspace_id')
          .eq('user_id', session.user.id)
          .single()

        if (!member) return

        const { data, error: dbErr } = await supabase
          .from('inbox_messages')
          .select('*')
          .eq('workspace_id', member.workspace_id)
          .order('received_at', { ascending: false })

        if (dbErr) throw dbErr
        setMessages(data ?? [])
      } catch {
        setError('Failed to load messages')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ── Select message ─────────────────────────────────────────────────────────

  const selectMessage = useCallback(async (msg: InboxMessage) => {
    setSelected(msg)
    setAiDraft('')
    setThread(null)

    // Mark as read
    if (!msg.is_read) {
      supabase
        .from('inbox_messages')
        .update({ is_read: true })
        .eq('id', msg.id)
        .then(() => {
          setMessages(prev =>
            prev.map(m => m.id === msg.id ? { ...m, is_read: true } : m)
          )
        })
    }

    // Load thread
    if (msg.thread_id) {
      setThreadLoading(true)
      try {
        const res = await fetch(`/api/inbox/messages/${msg.id}/thread`)
        const data = await res.json()
        setThread(data.items ?? null)
      } catch {
        setThread(null)
      } finally {
        setThreadLoading(false)
      }
    }
  }, [])

  // ── Actions ────────────────────────────────────────────────────────────────

  async function toggleStar(msg: InboxMessage, e: React.MouseEvent) {
    e.stopPropagation()
    const next = !msg.is_starred
    await supabase.from('inbox_messages').update({ is_starred: next }).eq('id', msg.id)
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_starred: next } : m))
    if (selected?.id === msg.id) setSelected(s => s ? { ...s, is_starred: next } : s)
  }

  async function archive(id: string) {
    await supabase.from('inbox_messages').update({ is_archived: true }).eq('id', id)
    setMessages(prev => prev.map(m => m.id === id ? { ...m, is_archived: true } : m))
    if (selected?.id === id) { setSelected(null); setThread(null) }
  }

  async function generateDraft() {
    if (!selected) return
    setGeneratingDraft(true)
    try {
      const res = await fetch('/api/inbox/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: selected }),
      })
      const data = await res.json()
      setAiDraft(data.draft || '')
    } finally {
      setGeneratingDraft(false)
    }
  }

  // ── Filter ─────────────────────────────────────────────────────────────────

  const filtered = messages.filter(m => {
    if (tab === 'unread') return !m.is_read && !m.is_archived
    if (tab === 'starred') return m.is_starred && !m.is_archived
    if (tab === 'archived') return m.is_archived
    return !m.is_archived
  })

  const unreadCount = messages.filter(m => !m.is_read && !m.is_archived).length

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Inbox</h1>
          <p className="text-sm text-[#8a7e6e] mt-0.5">
            Replies from prospects across all campaigns
          </p>
        </div>
        <div className="flex gap-1 bg-[#f5f3f0] border border-[#e8e3dc] rounded-xl p-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'bg-white text-[#1a1a2e] shadow-sm border border-[#e8e3dc]'
                  : 'text-[#8a7e6e] hover:text-[#4a3f32]'
              }`}
            >
              {t.key === 'unread' && unreadCount > 0
                ? `Unread (${unreadCount})`
                : t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Split panel */}
      <div className="flex gap-4 flex-1 min-h-0" style={{ height: 'calc(100vh - 220px)' }}>

        {/* Message list */}
        <div className="w-80 flex-shrink-0 bg-white border border-[#e8e3dc] rounded-xl overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-sm text-[#8a7e6e]">Loading...</div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-red-500">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-3xl mb-3">📬</div>
              <div className="font-semibold text-[#1a1a2e] mb-1 text-sm">No messages</div>
              <div className="text-xs text-[#8a7e6e]">
                {tab === 'unread'
                  ? 'All caught up.'
                  : 'Replies from prospects will appear here.'}
              </div>
            </div>
          ) : (
            filtered.map(m => (
              <button
                key={m.id}
                onClick={() => selectMessage(m)}
                className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-[#f0ece6] hover:bg-[#faf8f5] transition-colors ${
                  selected?.id === m.id ? 'bg-[#f4f6ff] border-l-2 border-l-[#3b6bef]' : ''
                }`}
              >
                {/* Avatar */}
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3b6bef] to-[#8b5cf6] flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5">
                  {initials(m.from_name, m.from_email)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`text-sm truncate ${
                      !m.is_read ? 'font-semibold text-[#1a1a2e]' : 'text-[#4a3f32]'
                    }`}>
                      {m.from_name || m.from_email}
                    </span>
                    <span className="text-[10px] text-[#b0a49a] flex-shrink-0 ml-2">
                      {formatTimestamp(m.received_at)}
                    </span>
                  </div>
                  {m.subject && (
                    <div className={`text-xs truncate mb-0.5 ${
                      !m.is_read ? 'text-[#4a3f32] font-medium' : 'text-[#6b5e4e]'
                    }`}>
                      {m.subject}
                    </div>
                  )}
                  <div className="text-[11px] text-[#8a7e6e] truncate leading-snug">
                    {m.body_preview || m.body?.slice(0, 80)}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <SentimentBadge sentiment={m.sentiment} />
                    {!m.is_read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3b6bef] flex-shrink-0" />
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Detail panel */}
        <div className="flex-1 bg-white border border-[#e8e3dc] rounded-xl overflow-hidden flex flex-col">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
              <div className="text-3xl mb-3">📭</div>
              <div className="font-semibold text-[#1a1a2e] mb-1 text-sm">Select a message</div>
              <div className="text-xs text-[#8a7e6e]">
                Click a message on the left to read it.
              </div>
            </div>
          ) : (
            <>
              {/* Message header */}
              <div className="flex items-start justify-between px-5 py-4 border-b border-[#f0ece6]">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3b6bef] to-[#8b5cf6] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    {initials(selected.from_name, selected.from_email)}
                  </div>
                  <div>
                    <div className="font-semibold text-[#1a1a2e] text-sm">
                      {selected.from_name || selected.from_email}
                    </div>
                    <div className="text-xs text-[#8a7e6e]">{selected.from_email}</div>
                    {selected.subject && (
                      <div className="text-sm text-[#4a3f32] mt-1 font-medium">
                        {selected.subject}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      <SentimentBadge sentiment={selected.sentiment} />
                      <span className="text-[10px] text-[#b0a49a]">
                        {new Date(selected.received_at).toLocaleString([], {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={e => toggleStar(selected, e)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#faf8f5] transition-colors"
                    title={selected.is_starred ? 'Unstar' : 'Star'}
                  >
                    {selected.is_starred ? '⭐' : '☆'}
                  </button>
                  <button
                    onClick={() => archive(selected.id)}
                    className="text-xs border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-[#6b5e4e] hover:bg-[#faf8f5] transition-colors"
                  >
                    Archive
                  </button>
                </div>
              </div>

              {/* Body / Thread view */}
              <div className="flex-1 overflow-y-auto">
                {selected.thread_id ? (
                  threadLoading ? (
                    <div className="p-6 text-sm text-[#8a7e6e]">Loading thread...</div>
                  ) : thread ? (
                    <ThreadView items={thread} />
                  ) : (
                    <div className="p-5 text-sm text-[#4a3f32] leading-relaxed whitespace-pre-wrap">
                      {selected.body}
                    </div>
                  )
                ) : (
                  <div className="p-5 text-sm text-[#4a3f32] leading-relaxed whitespace-pre-wrap">
                    {selected.body}
                  </div>
                )}
              </div>

              {/* AI Draft section */}
              <div className="px-5 py-4 border-t border-[#f0ece6]">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[11px] font-semibold text-[#8a7e6e] uppercase tracking-wider">
                    AI Draft Reply
                  </span>
                  <button
                    onClick={generateDraft}
                    disabled={generatingDraft}
                    className="text-xs bg-[#3b6bef] text-white px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-[#2d5ce0] transition-colors"
                  >
                    {generatingDraft ? 'Generating...' : '✦ Generate draft'}
                  </button>
                </div>
                {aiDraft && (
                  <textarea
                    value={aiDraft}
                    onChange={e => setAiDraft(e.target.value)}
                    className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#3b6bef] resize-none text-[#4a3f32] leading-relaxed"
                    rows={4}
                    placeholder="Your draft reply..."
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
