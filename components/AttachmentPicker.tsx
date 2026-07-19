'use client'

/**
 * <AttachmentPicker />
 *
 * Bouton trombone + popover à 2 zones (upload / bibliothèque). Utilisé dans
 * les 3 surfaces de composition d'e-mail : EditEmailModal, EditFollowUpModal,
 * inbox reply composer.
 *
 * Contrat :
 *   - Le picker mute le `body` via `setBody(insertFileLink(body, url, sig))`
 *     ou `setBody(stripFileLink(body, url))` — aucune écriture DB dans la
 *     session courante (le POST /api/attachments écrit la row en amont, avant
 *     l'insertion du lien dans le body ; le Save du modal parent fera la
 *     persistance du body).
 *   - Les chips affichées reconstruisent l'état DEPUIS le body : on scanne
 *     avec `${appUrl}/f/<token>` (regex) puis on lookup les métadonnées via
 *     GET /api/attachments (workspace-scopé). Ainsi un draft rouvert qui
 *     contenait déjà un lien affiche la chip correctement.
 *   - `×` sur une chip = stripFileLink UNIQUEMENT (le fichier reste en
 *     bibliothèque, réutilisable). Le DELETE réel se fait depuis la vue
 *     bibliothèque avec confirmation.
 *   - Nudge first-touch = props uniquement (`isFirstTouch`) — le banner est
 *     rendu par le PARENT quand `isFirstTouch && attachedTokens.length > 0`
 *     via la ref exposée `attachedTokens` (voir hook useAttachmentPicker).
 *
 * Design tokens (sentra-design-system) : #3b6bef marque (ne pas repeindre),
 * #e8e3dc/#f0ece6 bordures, #eef1fd actif, #1a1a2e/#6b5e4e/#8a7e6e texte.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Paperclip, Upload, X, FileText, Loader2 } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'
import { insertFileLink, stripFileLink } from '@/lib/normalize-body'

export interface AttachmentItem {
  id:         string
  token:      string
  filename:   string
  mime_type:  string
  size_bytes: number
  created_at: string
  url:        string   // https://www.mirvo.ai/f/<token>
}

export interface AttachmentPickerProps {
  body:            string
  setBody:         (next: string) => void
  signature:       string
  isFirstTouch:    boolean
  disabled?:       boolean
}

/**
 * Regex scan du body pour reconstruire les chips depuis n'importe quel state
 * (draft rouvert, body chargé via API, etc.). On match `<appUrl>/f/<token>`
 * puis on lookup les métadonnées via la biblio.
 *
 * Le token est base64url ⇒ [A-Za-z0-9_-]{16,128}. Aligné sur le regex de
 * validation côté server (app/f/[token]/route.ts).
 */
function extractAttachedTokens(body: string, appUrl: string): Set<string> {
  const escapedAppUrl = appUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escapedAppUrl}/f/([A-Za-z0-9_-]{16,128})`, 'g')
  const tokens = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) tokens.add(m[1])
  return tokens
}

function formatBytes(n: number): string {
  if (n < 1024)       return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function AttachmentPicker({ body, setBody, signature, isFirstTouch, disabled }: AttachmentPickerProps) {
  const t = useTranslations('components.attachmentPicker')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'
  const [open, setOpen] = useState(false)
  const [tab, setTab]   = useState<'upload' | 'library'>('upload')
  const [uploading, setUploading]     = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [library, setLibrary]         = useState<AttachmentItem[] | null>(null)
  const [libraryError, setLibraryError] = useState<boolean>(false)
  const [isDragging, setIsDragging]   = useState(false)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Chips reconstruites depuis le body à chaque render (source de vérité).
  const attachedTokens = useMemo(() => extractAttachedTokens(body, appUrl), [body, appUrl])
  const attachedChips  = useMemo(() => {
    if (!library) return [] as AttachmentItem[]
    return library.filter((it) => attachedTokens.has(it.token))
  }, [library, attachedTokens])

  // Click outside + Esc → close.
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Charge la bibliothèque au premier open, puis à chaque upload/attach.
  const loadLibrary = useCallback(async () => {
    try {
      const res = await fetch('/api/attachments', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json() as { items: AttachmentItem[] }
      setLibrary(json.items ?? [])
      setLibraryError(false)
    } catch {
      setLibraryError(true)
      // Ne casse pas la surface : l'utilisateur peut toujours uploader.
    }
  }, [])

  useEffect(() => {
    if (open && library === null) void loadLibrary()
  }, [open, library, loadLibrary])

  const attachItem = useCallback((item: AttachmentItem) => {
    setBody(insertFileLink(body, item.url, signature))
    setOpen(false)
  }, [body, setBody, signature])

  const detachToken = useCallback((token: string) => {
    // On retrouve l'URL exacte depuis le body (soit via biblio, soit
    // reconstruite avec l'appUrl connu — les deux formes matchent la regex
    // de stripFileLink car elle escape l'URL complète).
    const item = library?.find((it) => it.token === token)
    const url  = item?.url ?? `${appUrl}/f/${token}`
    setBody(stripFileLink(body, url))
  }, [body, setBody, library, appUrl])

  const uploadFile = useCallback(async (file: File) => {
    setUploadError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/attachments', { method: 'POST', body: form })
      if (!res.ok) {
        // On surface le message renvoyé par la route (code type/taille) pour
        // que l'utilisateur puisse comprendre. Fall-back générique.
        let msg = t('uploadFailedGeneric')
        try {
          const err = await res.json() as { error?: string; code?: string }
          if (err.code === 'size')       msg = t('uploadErrorSize')
          else if (err.code === 'mime')  msg = t('uploadErrorMime')
          else if (err.code === 'extension') msg = t('uploadErrorExtension')
          else if (err.code === 'empty') msg = t('uploadErrorEmpty')
          else if (err.code === 'name')  msg = t('uploadErrorName')
          else if (err.error)            msg = err.error
        } catch { /* leave fallback */ }
        setUploadError(msg)
        return
      }
      const item = await res.json() as AttachmentItem
      // Insère le lien dans le body, refresh la biblio, ferme le popover.
      setBody(insertFileLink(body, item.url, signature))
      setLibrary((prev) => prev ? [item, ...prev] : [item])
      setOpen(false)
    } catch {
      setUploadError(t('uploadFailedGeneric'))
    } finally {
      setUploading(false)
    }
  }, [body, setBody, signature, t])

  const onPickFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void uploadFile(file)
    e.target.value = ''  // reset pour permettre le re-upload du même fichier
  }, [uploadFile])

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void uploadFile(file)
  }, [uploadFile])

  return (
    <div className="flex flex-col gap-2">
      {/* Trombone + chips inline */}
      <div ref={wrapperRef} className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={disabled}
            aria-label={t('trigger')}
            aria-haspopup="menu"
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 border border-[#e8e3dc] rounded-lg px-2.5 py-1.5 text-xs text-[#6b5e4e] hover:bg-[#f0ece6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Paperclip size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>{t('trigger')}</span>
          </button>

          {/* Chips */}
          {Array.from(attachedTokens).map((token) => {
            const item = library?.find((it) => it.token === token)
            const label = item?.filename ?? t('chipUnknownFile')
            return (
              <span
                key={token}
                className="inline-flex items-center gap-1.5 bg-[#eef1fd] border border-[#dde6fd] text-[#3b6bef] rounded-lg pl-2.5 pr-1.5 py-1 text-xs font-medium"
              >
                <FileText size={12} strokeWidth={1.75} aria-hidden="true" />
                <span className="max-w-[180px] truncate">{label}</span>
                <button
                  type="button"
                  onClick={() => detachToken(token)}
                  disabled={disabled}
                  aria-label={t('chipDetachAria', { filename: label })}
                  className="rounded-full p-0.5 hover:bg-[#dde6fd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] disabled:opacity-50"
                >
                  <X size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              </span>
            )
          })}
        </div>

        {/* Popover */}
        {open && (
          <div
            role="menu"
            aria-label={t('popoverAria')}
            className="absolute left-0 top-9 w-80 sm:w-96 bg-white border border-[#e8e3dc] rounded-xl shadow-lg z-50 overflow-hidden"
          >
            {/* Tabs */}
            <div className="flex items-center gap-1 px-3 pt-3 pb-1 border-b border-[#f0ece6]">
              <button
                type="button"
                onClick={() => setTab('upload')}
                className={
                  'text-xs px-2.5 py-1 rounded-full border transition-colors ' +
                  (tab === 'upload'
                    ? 'bg-[#eef1fd] text-[#3b6bef] border-[#dde6fd]'
                    : 'bg-white text-[#6b5e4e] border-[#e8e3dc] hover:bg-[#f7f4f0]')
                }
              >
                {t('tabUpload')}
              </button>
              <button
                type="button"
                onClick={() => setTab('library')}
                className={
                  'text-xs px-2.5 py-1 rounded-full border transition-colors ' +
                  (tab === 'library'
                    ? 'bg-[#eef1fd] text-[#3b6bef] border-[#dde6fd]'
                    : 'bg-white text-[#6b5e4e] border-[#e8e3dc] hover:bg-[#f7f4f0]')
                }
              >
                {t('tabLibrary')}
              </button>
            </div>

            {/* Body */}
            {tab === 'upload' ? (
              <div className="p-4">
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={
                    'flex flex-col items-center justify-center gap-2 border border-dashed rounded-xl px-4 py-6 cursor-pointer transition-colors ' +
                    (isDragging
                      ? 'border-[#3b6bef] bg-[#eef1fd]'
                      : 'border-[#e8e3dc] bg-[#faf7f2] hover:bg-[#f7f4f0]')
                  }
                >
                  {uploading ? (
                    <>
                      <Loader2 size={20} className="animate-spin text-[#3b6bef]" aria-hidden="true" />
                      <div className="text-xs text-[#6b5e4e]">{t('uploading')}</div>
                    </>
                  ) : (
                    <>
                      <Upload size={20} strokeWidth={1.75} className="text-[#8a7e6e]" aria-hidden="true" />
                      <div className="text-xs text-[#1a1a2e] font-medium text-center">{t('dropzoneTitle')}</div>
                      <div className="text-[11px] text-[#8a7e6e] text-center">{t('dropzoneSubtitle')}</div>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={onPickFile}
                  disabled={uploading}
                />
                {uploadError && (
                  <p className="mt-3 text-xs text-red-600">{uploadError}</p>
                )}
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                {library === null && !libraryError ? (
                  <div className="p-4 text-xs text-[#8a7e6e]">{t('libraryLoading')}</div>
                ) : libraryError ? (
                  <div className="p-4 text-xs text-red-600">{t('libraryError')}</div>
                ) : library && library.length === 0 ? (
                  <div className="p-6 text-center">
                    <div className="text-sm text-[#1a1a2e] font-medium mb-1">{t('libraryEmptyTitle')}</div>
                    <div className="text-xs text-[#6b5e4e]">{t('libraryEmptyBody')}</div>
                  </div>
                ) : (
                  <ul className="py-1">
                    {(library ?? []).map((it) => {
                      const isAttached = attachedTokens.has(it.token)
                      return (
                        <li key={it.id}>
                          <button
                            type="button"
                            onClick={() => attachItem(it)}
                            disabled={isAttached}
                            className={
                              'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b6bef] ' +
                              (isAttached
                                ? 'bg-[#faf7f2] text-[#8a7e6e] cursor-not-allowed'
                                : 'hover:bg-[#f7f4f0] text-[#1a1a2e]')
                            }
                          >
                            <FileText size={14} strokeWidth={1.75} className="flex-shrink-0 text-[#8a7e6e]" aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium truncate">{it.filename}</div>
                              <div className="text-[11px] text-[#8a7e6e]">{formatBytes(it.size_bytes)}</div>
                            </div>
                            {isAttached && (
                              <StatusBadge variant="blueprint">{t('libraryAttached')}</StatusBadge>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Nudge first-touch — banner persistant sous le picker quand le contexte est premier contact ET au moins un lien est attaché. */}
      {isFirstTouch && attachedTokens.size > 0 && (
        <div
          role="note"
          className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
        >
          <StatusBadge variant="amber" className="mt-0.5">{t('nudgeBadge')}</StatusBadge>
          <p className="text-xs text-[#6b5e4e] leading-relaxed">
            {t('nudgeBody')}
          </p>
        </div>
      )}
    </div>
  )
}
