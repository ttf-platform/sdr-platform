'use client'
import { useState } from 'react'

interface Note {
  id:         string
  content:    string
  created_at: string
  updated_at: string
  author_id:  string | null
  author_name?: string | null
}

interface Props {
  note:      Note
  isAuthor:  boolean
  onEdit:    (id: string, content: string) => void
  onDelete:  (id: string) => void
}

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  < 1)  return 'Just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days  < 7)  return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function NoteItem({ note, isAuthor, onEdit, onDelete }: Props) {
  const [editing,   setEditing]   = useState(false)
  const [draft,     setDraft]     = useState(note.content)
  const [saving,    setSaving]    = useState(false)
  const [confirm,   setConfirm]   = useState(false)
  const [hovering,  setHovering]  = useState(false)

  async function saveEdit() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === note.content) { setEditing(false); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: trimmed }),
      }).then(r => r.json())
      if (!res.error) onEdit(note.id, trimmed)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  async function confirmDelete() {
    await fetch(`/api/notes/${note.id}`, { method: 'DELETE' })
    onDelete(note.id)
  }

  return (
    <div
      className="relative group"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="bg-[#faf8f5] border border-[#f0ece6] rounded-lg p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-[#8a7e6e]">
            {note.author_name ?? 'You'} · {relativeDate(note.created_at)}
            {note.updated_at !== note.created_at && ' (edited)'}
          </span>

          {isAuthor && hovering && !editing && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setDraft(note.content); setEditing(true) }}
                className="text-[10px] text-[#8a7e6e] hover:text-[#3b6bef]"
              >Edit</button>
              <button
                onClick={() => setConfirm(true)}
                className="text-[10px] text-[#8a7e6e] hover:text-red-500"
              >Delete</button>
            </div>
          )}
        </div>

        {editing ? (
          <div>
            <textarea
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value.slice(0, 5000))}
              rows={3}
              maxLength={5000}
              className="w-full border border-[#e8e3dc] rounded-lg px-2 py-1.5 text-xs resize-none focus:outline-none focus:border-[#3b6bef] bg-white"
            />
            <div className="flex justify-end gap-2 mt-1.5">
              <button onClick={() => setEditing(false)} disabled={saving}
                className="text-xs text-[#8a7e6e] hover:text-[#1a1a2e] disabled:opacity-40">Cancel</button>
              <button onClick={saveEdit} disabled={saving || !draft.trim()}
                className="text-xs bg-[#3b6bef] text-white px-3 py-1 rounded-md hover:bg-[#2d5cd9] disabled:opacity-40">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[#1a1a2e] whitespace-pre-wrap break-words">{note.content}</p>
        )}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs mx-4 p-5">
            <p className="text-sm font-semibold text-[#1a1a2e] mb-1">Delete this note?</p>
            <p className="text-xs text-[#8a7e6e] mb-4">This action cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirm(false)}
                className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm">Cancel</button>
              <button onClick={confirmDelete}
                className="flex-1 bg-red-500 text-white rounded-lg py-2 text-sm font-semibold">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
