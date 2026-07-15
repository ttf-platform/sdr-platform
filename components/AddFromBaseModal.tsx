'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'

interface Contact {
  id:          string
  email:       string
  first_name?: string | null
  last_name?:  string | null
  company?:    string | null
}

interface Props {
  isOpen:     boolean
  onClose:    () => void
  campaignId: string
  onEnrolled: () => void
}

const PAGE_LIMIT = 50
const ALREADY_IN_MAX = 500

export function AddFromBaseModal({ isOpen, onClose, campaignId, onEnrolled }: Props) {
  const t = useTranslations('components.addFromBaseModal')
  const tCommon = useTranslations('dashboard.common')

  const [contacts, setContacts] = useState<Contact[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [alreadyIn, setAlreadyIn] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce search input → search
  useEffect(() => {
    if (!isOpen) return
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [searchInput, isOpen])

  // Reset state on open
  useEffect(() => {
    if (!isOpen) return
    setContacts([])
    setTotal(0)
    setPage(1)
    setSearchInput('')
    setSearch('')
    setSelected(new Set())
    setError(null)
  }, [isOpen])

  // Load "already in campaign" set once on open (up to ALREADY_IN_MAX contacts)
  useEffect(() => {
    if (!isOpen) return
    fetch(`/api/prospects?campaign_id=${campaignId}&limit=100&page=1`)
      .then(r => r.json())
      .then(d => {
        const set = new Set<string>((d.prospects ?? []).map((p: { contact_id: string }) => p.contact_id))
        setAlreadyIn(set)
      })
      .catch(() => { /* non-fatal — server dedup still guards */ })
  }, [isOpen, campaignId])

  // Load contacts page
  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    const params = new URLSearchParams({ page: '1', limit: String(PAGE_LIMIT) })
    if (search) params.set('search', search)
    fetch(`/api/contacts?${params}`)
      .then(r => r.json())
      .then(d => {
        setContacts(d.contacts ?? [])
        setTotal(d.total ?? 0)
        setPage(1)
      })
      .finally(() => setLoading(false))
  }, [isOpen, search])

  async function loadMore() {
    setLoadingMore(true)
    const nextPage = page + 1
    const params = new URLSearchParams({ page: String(nextPage), limit: String(PAGE_LIMIT) })
    if (search) params.set('search', search)
    try {
      const d = await fetch(`/api/contacts?${params}`).then(r => r.json())
      setContacts(prev => [...prev, ...(d.contacts ?? [])])
      setPage(nextPage)
    } finally {
      setLoadingMore(false)
    }
  }

  function toggle(id: string) {
    if (alreadyIn.has(id)) return
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const hasMore = contacts.length < total

  const selectableCount = useMemo(
    () => contacts.filter(c => !alreadyIn.has(c.id)).length,
    [contacts, alreadyIn],
  )

  async function submit() {
    if (selected.size === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/prospects`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contact_ids: [...selected] }),
      })
      if (!res.ok) {
        setError(t('error'))
        setSubmitting(false)
        return
      }
      const data = await res.json() as { enrolled: number; skipped_dedup: number }
      toast.success(t('successAdded', { count: data.enrolled }))
      if (data.skipped_dedup > 0) {
        toast.message(t('successSkipped', { count: data.skipped_dedup }))
      }
      onEnrolled()
      onClose()
    } catch {
      setError(t('error'))
      setSubmitting(false)
    }
  }

  function displayName(c: Contact): string {
    const n = [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
    return n || c.email
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('title')}
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-sm border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-[#6b5e4e] hover:bg-[#f5f2ee] disabled:opacity-40"
          >
            {tCommon('cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || selected.size === 0}
            className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? t('submitting') : t('submit')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <input
          type="search"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
        />

        {error && (
          <div role="alert" className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>
        )}

        <div className="border border-[#e8e3dc] rounded-lg max-h-[420px] overflow-y-auto">
          {loading && contacts.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#8a7e6e]">…</div>
          ) : contacts.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#8a7e6e]">{t('empty')}</div>
          ) : (
            <ul className="divide-y divide-[#f0ece6]">
              {contacts.map(c => {
                const isIn = alreadyIn.has(c.id)
                const isSel = selected.has(c.id)
                return (
                  <li key={c.id}>
                    <label
                      className={`flex items-center gap-3 px-3 py-2.5 ${
                        isIn
                          ? 'cursor-not-allowed opacity-50'
                          : 'cursor-pointer hover:bg-[#f7f4f0]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSel}
                        disabled={isIn}
                        onChange={() => toggle(c.id)}
                        className="w-4 h-4 accent-[#3b6bef]"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-[#1a1a2e] truncate">{displayName(c)}</div>
                        <div className="text-xs text-[#8a7e6e] truncate">
                          {c.company ? `${c.company} · ${c.email}` : c.email}
                        </div>
                      </div>
                      {isIn && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8a7e6e] bg-[#f0ece6] px-2 py-0.5 rounded-full flex-shrink-0">
                          {t('alreadyIn')}
                        </span>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}

          {hasMore && (
            <div className="p-3 border-t border-[#f0ece6] text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="text-sm text-[#3b6bef] font-medium hover:underline disabled:opacity-40"
              >
                {loadingMore ? '…' : t('loadMore')}
              </button>
            </div>
          )}
        </div>

        <div className="text-xs text-[#8a7e6e] text-right">
          {t('selected', { count: selected.size })}
          {selectableCount > 0 && ` · ${contacts.length} / ${total}`}
        </div>
      </div>
    </Modal>
  )
}
