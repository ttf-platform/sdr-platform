'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  id?: string
}

interface Conversation {
  id: string
  title: string
  created_at: string
}

interface Props {
  onBack: () => void
  onClose: () => void
}

export function AskAIChat({ onBack, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [kebabOpen, setKebabOpen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<Conversation[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const kebabRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (kebabRef.current && !kebabRef.current.contains(e.target as Node)) {
        setKebabOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function loadHistory() {
    setHistoryLoading(true)
    try {
      const res = await fetch('/api/bot/conversations')
      if (res.ok) {
        const data = await res.json()
        setHistory(data.conversations ?? [])
      }
    } finally {
      setHistoryLoading(false)
    }
  }

  async function loadConversation(id: string) {
    setConversationId(id)
    setShowHistory(false)
    setMessages([])
    try {
      const res = await fetch(`/api/bot/conversations/${id}/messages`)
      if (res.ok) {
        const data = await res.json()
        const msgs: Message[] = (data.messages ?? [])
          .filter((m: { role: string; content: string }) => m.role === 'user' || m.role === 'assistant')
          .map((m: { role: string; content: string; id?: string }) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            id: m.id,
          }))
        setMessages(msgs)
      }
    } catch {}
  }

  async function escalateToHuman() {
    setKebabOpen(false)
    if (!conversationId) return
    try {
      await fetch('/api/bot/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          reason: 'user_request',
          summary: 'User requested human support from chat',
        }),
      })
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: "I've escalated your conversation to our support team. They'll reach out to you soon.",
        },
      ])
    } catch {}
  }

  function clearChat() {
    setKebabOpen(false)
    setMessages([])
    setConversationId(null)
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)

    const assistantMsgId = Date.now().toString()
    setMessages(prev => [...prev, { role: 'assistant', content: '', id: assistantMsgId }])

    try {
      const res = await fetch('/api/bot/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversationId: conversationId ?? undefined }),
      })
      if (!res.ok) throw new Error('Bot request failed')
      const data = await res.json()

      if (data.isNewConversation && data.conversationId) {
        setConversationId(data.conversationId)
      }
      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId
          ? { ...m, content: data.text || '(empty response)' }
          : m
      ))
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId
          ? { ...m, content: 'I had trouble connecting. Please try again in a moment.' }
          : m
      ))
    } finally {
      setLoading(false)
    }
  }

  if (showHistory) {
    return (
      <>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#f0ece6]">
          <button onClick={() => setShowHistory(false)} className="text-[#8a7e6e] hover:text-[#1a1a2e]">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span className="text-sm font-semibold text-[#1a1a2e]">Conversation history</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {historyLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-[#8a7e6e]">Loading…</div>
          ) : history.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-sm text-[#8a7e6e]">No previous conversations</div>
          ) : (
            history.map(conv => (
              <button
                key={conv.id}
                onClick={() => loadConversation(conv.id)}
                className="w-full text-left px-4 py-3 border-b border-[#f0ece6] hover:bg-[#f7f4f0] transition-colors"
              >
                <div className="text-sm font-medium text-[#1a1a2e] truncate">{conv.title || 'Untitled'}</div>
                <div className="text-xs text-[#8a7e6e] mt-0.5">
                  {new Date(conv.created_at).toLocaleDateString()}
                </div>
              </button>
            ))
          )}
        </div>
      </>
    )
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#f0ece6] flex-shrink-0">
        <button onClick={onBack} className="text-[#8a7e6e] hover:text-[#1a1a2e]">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="text-sm font-semibold text-[#1a1a2e] flex-1">Ask AI</span>
        <div ref={kebabRef} className="relative">
          <button
            onClick={() => setKebabOpen(!kebabOpen)}
            className="text-[#8a7e6e] hover:text-[#1a1a2e] p-1"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="3" r="1.2" fill="currentColor"/>
              <circle cx="8" cy="8" r="1.2" fill="currentColor"/>
              <circle cx="8" cy="13" r="1.2" fill="currentColor"/>
            </svg>
          </button>
          {kebabOpen && (
            <div className="absolute right-0 top-8 w-48 bg-white border border-[#e8e3dc] rounded-xl shadow-lg overflow-hidden z-10">
              <button
                onClick={escalateToHuman}
                disabled={!conversationId}
                className="w-full text-left px-4 py-2.5 text-sm text-[#1a1a2e] hover:bg-[#f7f4f0] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Talk to a human
              </button>
              <button
                onClick={clearChat}
                className="w-full text-left px-4 py-2.5 text-sm text-[#1a1a2e] hover:bg-[#f7f4f0]"
              >
                Clear chat
              </button>
              <button
                onClick={() => { setKebabOpen(false); setShowHistory(true); loadHistory() }}
                className="w-full text-left px-4 py-2.5 text-sm text-[#1a1a2e] hover:bg-[#f7f4f0]"
              >
                History
              </button>
            </div>
          )}
        </div>
        <button onClick={onClose} className="text-[#8a7e6e] hover:text-[#1a1a2e]">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-full bg-[#eef1fd] flex items-center justify-center mx-auto mb-3">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M3 4a1 1 0 011-1h14a1 1 0 011 1v10a1 1 0 01-1 1H6l-3 3V4z" stroke="#3b6bef" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="text-sm font-medium text-[#1a1a2e]">Ask me anything</div>
            <div className="text-xs text-[#8a7e6e] mt-1">I can help with campaigns, prospects, billing, and more.</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-[#3b6bef] text-white rounded-br-sm'
                  : 'bg-[#f0ece6] text-[#1a1a2e] rounded-bl-sm'
              }`}
            >
              {msg.content || (loading && msg.role === 'assistant' ? (
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8a7e6e] animate-bounce" style={{ animationDelay: '0ms' }}/>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8a7e6e] animate-bounce" style={{ animationDelay: '150ms' }}/>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8a7e6e] animate-bounce" style={{ animationDelay: '300ms' }}/>
                </span>
              ) : '')}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 pb-3 pt-2 border-t border-[#f0ece6] flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder="Type a message…"
            rows={1}
            className="flex-1 text-sm border border-[#e8e3dc] rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-[#3b6bef] text-[#1a1a2e] placeholder:text-[#c0bab2] max-h-24 overflow-y-auto"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="w-9 h-9 rounded-xl bg-[#3b6bef] text-white flex items-center justify-center hover:bg-[#2a5bdf] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M13 7.5L2 2l2.5 5.5L2 13l11-5.5z" fill="white"/>
            </svg>
          </button>
        </div>
      </div>
    </>
  )
}
