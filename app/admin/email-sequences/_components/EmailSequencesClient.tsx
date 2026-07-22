'use client'

/**
 * Admin editor for the 8 platform email templates.
 *
 * Layout : 2-column desktop (list ~300px + editor). Mobile stacks vertically
 * — the list becomes an accordion of collapsed group headers with the
 * selected item scrolled into view when the user picks one.
 *
 * State model : entries are fetched once via GET /api/admin/email-templates,
 * kept in `serverEntries` as the "canonical" state. The active editor's
 * fields live in `draft`, updated locally on every keystroke ; Save PUTs the
 * draft and refreshes `serverEntries`. Reset DELETEs the row and refreshes.
 *
 * Preview : the iframe's srcDoc is rebuilt from a debounced POST /preview
 * that returns the exact HTML the send pipeline would produce. `sandbox=""`
 * on the iframe strips scripts + top navigation — even if a whitelist bug
 * let a tag through, it cannot escape the frame.
 *
 * Design tokens : #f5f2ee page bg, #fff card bg, #e8e3dc borders, #3b6bef
 * for active tabs / Save / focus rings, #1a1a1a primary text, #6b5e4e /
 * #8a7e6e captions. Overridden badge uses StatusBadge amber (no color-only
 * text).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/StatusBadge'
import {
  EMAIL_TEMPLATE_META,
  type EmailTemplateCategory,
  type EmailTemplateKey,
  type EmailTemplateLocale,
} from '@/lib/email-templates-registry'

type DbFields = {
  subject:    string
  preheader:  string | null
  heading:    string | null
  body_md:    string
  cta_label:  string | null
  cta_path:   string | null
}

type ServerEntry = {
  key:        EmailTemplateKey
  locale:     EmailTemplateLocale
  fields: {
    subject:    string
    preheader:  string | null
    heading:    string | null
    bodyMd:     string
    ctaLabel:   string | null
    ctaPath:    string | null
  }
  overridden: boolean
  updated_at: string | null
}

type MetaEntry = typeof EMAIL_TEMPLATE_META[number]

const CATEGORY_LABEL: Record<EmailTemplateCategory, string> = {
  onboarding: 'Onboarding',
  billing:    'Facturation',
  product:    'Produit',
}

const KEY_LABEL: Record<EmailTemplateKey, string> = {
  onboarding_d0:          'Bienvenue (J0)',
  onboarding_d2:          'Signaux (J2)',
  onboarding_d4:          'Délivrabilité (J4)',
  onboarding_d7:          'Bilan semaine 1 (J7)',
  upgrade:                'Upgrade confirmé',
  dunning:                'Paiement échoué (J0)',
  dunning_j3:             'Paiement échoué — J+3',
  dunning_j7:             'Paiement échoué — J+7 (dernier rappel)',
  cancellation:           'Résiliation confirmée',
  winback:                'Win-back (relance résiliation)',
  signal_digest:          'Digest quotidien de signaux',
}

function entryKey(k: EmailTemplateKey, l: EmailTemplateLocale): string {
  return `${k}:${l}`
}

function toDbFields(e: ServerEntry['fields']): DbFields {
  return {
    subject:   e.subject,
    preheader: e.preheader,
    heading:   e.heading,
    body_md:   e.bodyMd,
    cta_label: e.ctaLabel,
    cta_path:  e.ctaPath,
  }
}

export function EmailSequencesClient() {
  const [entriesByKey, setEntriesByKey] = useState<Map<string, ServerEntry>>(new Map())
  const [meta, setMeta]                 = useState<MetaEntry[]>([])
  const [loading, setLoading]           = useState(true)
  const [loadError, setLoadError]       = useState<string | null>(null)
  const [activeKey, setActiveKey]       = useState<EmailTemplateKey>('onboarding_d0')
  const [activeLocale, setActiveLocale] = useState<EmailTemplateLocale>('en')
  const [draft, setDraft]               = useState<DbFields | null>(null)
  const [saving, setSaving]             = useState(false)
  const [resetting, setResetting]       = useState(false)
  const [previewHtml, setPreviewHtml]   = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const lastFocusedField = useRef<'subject' | 'preheader' | 'heading' | 'body_md' | 'cta_label' | 'cta_path'>('body_md')
  const bodyRef       = useRef<HTMLTextAreaElement | null>(null)
  const subjectRef    = useRef<HTMLInputElement    | null>(null)
  const preheaderRef  = useRef<HTMLInputElement    | null>(null)
  const headingRef    = useRef<HTMLInputElement    | null>(null)
  const ctaLabelRef   = useRef<HTMLInputElement    | null>(null)
  const ctaPathRef    = useRef<HTMLInputElement    | null>(null)

  // ─── Initial load ─────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/admin/email-templates', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as { meta: MetaEntry[]; entries: ServerEntry[] }
      const map = new Map<string, ServerEntry>()
      for (const e of json.entries) map.set(entryKey(e.key, e.locale), e)
      setEntriesByKey(map)
      setMeta(json.meta)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'unknown')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // Sync draft when selection or server state changes.
  useEffect(() => {
    const entry = entriesByKey.get(entryKey(activeKey, activeLocale))
    if (entry) setDraft(toDbFields(entry.fields))
  }, [activeKey, activeLocale, entriesByKey])

  // ─── Debounced preview ────────────────────────────────────────────────────

  useEffect(() => {
    if (!draft) return
    setPreviewLoading(true)
    const handle = setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/email-templates/preview', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ key: activeKey, locale: activeLocale, fields: draft }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json() as { html: string }
        setPreviewHtml(json.html)
      } catch {
        setPreviewHtml('<p style="font-family:sans-serif;color:#8a7e6e;padding:24px;">Preview failed. Check your edits.</p>')
      } finally {
        setPreviewLoading(false)
      }
    }, 400)
    return () => clearTimeout(handle)
  }, [draft, activeKey, activeLocale])

  // ─── Save / Reset ─────────────────────────────────────────────────────────

  async function save() {
    if (!draft || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/email-templates', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ key: activeKey, locale: activeLocale, ...draft }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error((body as { message?: string; error?: string }).message ?? (body as { error?: string }).error ?? `Erreur ${res.status}`)
        return
      }
      toast.success(activeLocale === 'fr' ? 'Enregistré' : 'Saved')
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'unknown')
    } finally {
      setSaving(false)
    }
  }

  async function reset() {
    if (resetting) return
    const confirmMsg = activeLocale === 'fr'
      ? `Réinitialiser « ${KEY_LABEL[activeKey]} » (${activeLocale.toUpperCase()}) au défaut ? Cette action supprime les modifications enregistrées pour cette locale.`
      : `Reset "${KEY_LABEL[activeKey]}" (${activeLocale.toUpperCase()}) to default ? This deletes the stored override for this locale.`
    if (!window.confirm(confirmMsg)) return
    setResetting(true)
    try {
      const res = await fetch('/api/admin/email-templates', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ key: activeKey, locale: activeLocale }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error((body as { error?: string }).error ?? `Erreur ${res.status}`)
        return
      }
      toast.success(activeLocale === 'fr' ? 'Réinitialisé au défaut' : 'Reset to default')
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'unknown')
    } finally {
      setResetting(false)
    }
  }

  // ─── Placeholder chip insertion ───────────────────────────────────────────

  function insertPlaceholder(token: string) {
    if (!draft) return
    const tag = `{{${token}}}`
    const targetField = lastFocusedField.current
    const refByField: Record<typeof targetField, React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>> = {
      subject:   subjectRef   as unknown as React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
      preheader: preheaderRef as unknown as React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
      heading:   headingRef   as unknown as React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
      body_md:   bodyRef      as unknown as React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
      cta_label: ctaLabelRef  as unknown as React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
      cta_path:  ctaPathRef   as unknown as React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
    }
    const el = refByField[targetField]?.current
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end   = el.selectionEnd   ?? el.value.length
    const current = String(draft[targetField] ?? '')
    const next = current.slice(0, start) + tag + current.slice(end)
    setDraft({ ...draft, [targetField]: next })
    requestAnimationFrame(() => {
      el.focus()
      const caret = start + tag.length
      try { el.setSelectionRange(caret, caret) } catch { /* ignore for older browsers */ }
    })
  }

  // ─── Derived data ─────────────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const acc = new Map<EmailTemplateCategory, MetaEntry[]>()
    for (const m of meta) {
      const list = acc.get(m.category) ?? []
      list.push(m)
      acc.set(m.category, list)
    }
    return [...acc.entries()]
  }, [meta])

  const activeMeta = useMemo(() => meta.find(m => m.key === activeKey), [meta, activeKey])
  const activeEntry = entriesByKey.get(entryKey(activeKey, activeLocale)) ?? null
  const isOverriddenEn = entriesByKey.get(entryKey(activeKey, 'en'))?.overridden ?? false
  const isOverriddenFr = entriesByKey.get(entryKey(activeKey, 'fr'))?.overridden ?? false

  function anyLocaleOverridden(key: EmailTemplateKey): boolean {
    return (entriesByKey.get(entryKey(key, 'en'))?.overridden ?? false)
      || (entriesByKey.get(entryKey(key, 'fr'))?.overridden ?? false)
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="text-sm text-[#6b5e4e]">Chargement des templates…</div>
      </div>
    )
  }
  if (loadError) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">Chargement échoué : {loadError}</div>
        <button type="button" onClick={loadAll} className="mt-3 rounded-md bg-[#3b6bef] px-3 py-1.5 text-sm text-white hover:bg-[#2a5bdf]">Réessayer</button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 md:py-8">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Séquences email</h1>
        <p className="mt-1 text-sm text-[#6b5e4e]">Éditez les 8 emails automatiques envoyés par la plateforme, en EN et FR.</p>
      </div>

      {/* Info banner */}
      <div className="mb-6 rounded-md border border-[#dde6fd] bg-[#eef1fd] px-4 py-3 text-sm text-[#1a1a1a]">
        Ces emails partent automatiquement à chaque événement lifecycle (signup, upgrade, paiement échoué, résiliation, digest quotidien). Le système envoie la version EN ou FR selon la langue de chaque workspace (<code className="text-xs">workspace_profiles.language</code>). Vous éditez les deux versions ici.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-6">

        {/* ── LIST ────────────────────────────────────────────────────────── */}
        <aside className="rounded-lg border border-[#e8e3dc] bg-white p-2 self-start">
          {grouped.map(([category, items]) => (
            <div key={category} className="mb-3 last:mb-0">
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[#8a7e6e]">
                {CATEGORY_LABEL[category]}
              </div>
              <ul className="flex flex-col gap-0.5">
                {items.map(m => {
                  const active = m.key === activeKey
                  const edited = anyLocaleOverridden(m.key)
                  return (
                    <li key={m.key}>
                      <button
                        type="button"
                        onClick={() => setActiveKey(m.key)}
                        className={
                          'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ' +
                          (active
                            ? 'bg-[#eff6ff] font-medium text-[#3b6bef]'
                            : 'text-[#1a1a1a] hover:bg-[#f5f2ee]')
                        }
                      >
                        <span className="truncate">{KEY_LABEL[m.key]}</span>
                        {edited && <StatusBadge variant="amber">Edited</StatusBadge>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </aside>

        {/* ── EDITOR ──────────────────────────────────────────────────────── */}
        <section className="min-w-0 space-y-4">
          {activeMeta && (
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-[#1a1a1a]">{KEY_LABEL[activeKey]}</h2>
                {activeEntry?.overridden && (
                  <StatusBadge variant="amber">Edited ({activeLocale.toUpperCase()})</StatusBadge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[#8a7e6e]">Déclencheur : {activeMeta.trigger}</p>
            </div>
          )}

          {/* Locale tabs */}
          <div role="tablist" aria-label="Locale" className="inline-flex overflow-hidden rounded-md border border-[#e8e3dc]">
            {(['en', 'fr'] as const).map(l => {
              const on = l === activeLocale
              const overridden = l === 'en' ? isOverriddenEn : isOverriddenFr
              return (
                <button
                  key={l}
                  role="tab"
                  aria-selected={on}
                  type="button"
                  onClick={() => setActiveLocale(l)}
                  className={
                    'inline-flex items-center gap-2 px-4 py-2 text-sm min-h-[44px] transition-colors ' +
                    (on
                      ? 'bg-[#3b6bef] text-white'
                      : 'text-[#6b5e4e] hover:bg-[#f5f2ee]')
                  }
                >
                  {l === 'en' ? 'English' : 'Français'}
                  {overridden && !on && <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="edited" />}
                </button>
              )
            })}
          </div>

          {draft && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* ── FIELDS ─────────────────────────────────────────────── */}
              <div className="space-y-3">
                <Field label="Objet" required>
                  <input
                    ref={subjectRef}
                    value={draft.subject}
                    onChange={e => setDraft({ ...draft, subject: e.target.value })}
                    onFocus={() => (lastFocusedField.current = 'subject')}
                    maxLength={500}
                    className={inputCls}
                  />
                </Field>

                <Field label="Pré-en-tête" hint="Aperçu court affiché dans les listes de boîte mail.">
                  <input
                    ref={preheaderRef}
                    value={draft.preheader ?? ''}
                    onChange={e => setDraft({ ...draft, preheader: e.target.value || null })}
                    onFocus={() => (lastFocusedField.current = 'preheader')}
                    maxLength={500}
                    className={inputCls}
                  />
                </Field>

                <Field label="Titre">
                  <input
                    ref={headingRef}
                    value={draft.heading ?? ''}
                    onChange={e => setDraft({ ...draft, heading: e.target.value || null })}
                    onFocus={() => (lastFocusedField.current = 'heading')}
                    maxLength={500}
                    className={inputCls}
                  />
                </Field>

                <Field label="Corps" required hint="Markdown : **gras**, listes 1. ou -, [libellé](url), paragraphes séparés par une ligne vide.">
                  <textarea
                    ref={bodyRef}
                    value={draft.body_md}
                    onChange={e => setDraft({ ...draft, body_md: e.target.value })}
                    onFocus={() => (lastFocusedField.current = 'body_md')}
                    rows={12}
                    maxLength={20000}
                    className={`${inputCls} min-h-[150px] font-mono text-[13px] leading-relaxed`}
                  />
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Libellé du bouton">
                    <input
                      ref={ctaLabelRef}
                      value={draft.cta_label ?? ''}
                      onChange={e => setDraft({ ...draft, cta_label: e.target.value || null })}
                      onFocus={() => (lastFocusedField.current = 'cta_label')}
                      maxLength={200}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Chemin du bouton" hint="Chemin on-domain, ex. /dashboard">
                    <input
                      ref={ctaPathRef}
                      value={draft.cta_path ?? ''}
                      onChange={e => setDraft({ ...draft, cta_path: e.target.value || null })}
                      onFocus={() => (lastFocusedField.current = 'cta_path')}
                      maxLength={500}
                      placeholder="/dashboard"
                      className={inputCls}
                    />
                  </Field>
                </div>

                {/* Placeholder chips */}
                {activeMeta && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-[#6b5e4e]">Placeholders disponibles</div>
                    <div className="flex flex-wrap gap-1.5">
                      {activeMeta.placeholders.map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => insertPlaceholder(p)}
                          className="rounded-md border border-[#e8e3dc] bg-[#f5f2ee] px-2 py-1 text-[11px] font-mono text-[#4a4a5a] hover:bg-[#eef1fd] hover:text-[#3b6bef]"
                        >
                          {'{{'}{p}{'}}'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="inline-flex min-h-[44px] items-center rounded-md bg-[#3b6bef] px-4 py-2 text-sm font-medium text-white hover:bg-[#2a5bdf] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    disabled={resetting || !activeEntry?.overridden}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-[#e8e3dc] px-4 py-2 text-sm text-[#4a4a5a] hover:bg-[#f5f2ee] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resetting ? 'Réinitialisation…' : 'Réinitialiser au défaut'}
                  </button>
                </div>
              </div>

              {/* ── PREVIEW ─────────────────────────────────────────────── */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-medium text-[#6b5e4e]">Aperçu ({activeLocale.toUpperCase()})</div>
                  {previewLoading && <div className="text-[11px] text-[#8a7e6e]">Rendu…</div>}
                </div>
                <div className="overflow-hidden rounded-md border border-[#e8e3dc] bg-white">
                  <iframe
                    key={`${activeKey}-${activeLocale}`}
                    title="Aperçu email"
                    sandbox=""
                    srcDoc={previewHtml}
                    className="h-[640px] w-full bg-white"
                  />
                </div>
                <p className="mt-2 text-[11px] text-[#8a7e6e]">Aperçu isolé (iframe sandbox). Les données sont des exemples fictifs (workspace Acme Co, plan Pro, etc.).</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// ─── Small primitives ──────────────────────────────────────────────────────

const inputCls = 'w-full rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#3b6bef] focus:outline-none focus:ring-1 focus:ring-[#3b6bef]'

function Field({ label, hint, required, children }: {
  label:    string
  hint?:    string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[#4a4a5a]">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[#8a7e6e]">{hint}</span>}
    </label>
  )
}
