'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AutoFillFromUrlButton } from '@/components/AutoFillFromUrlButton'
import type { ExtractedFields } from '@/components/AutoFillPreviewModal'
import { StatusBadge } from '@/components/StatusBadge'
import { Tooltip } from '@/components/Tooltip'
import ProfileQualityBadge from '@/components/ProfileQualityBadge'
import { useWorkspace } from '@/lib/hooks/useWorkspace'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

const COMPANY_SIZES  = ['1-10', '10-50', '50-200', '200-500', '500-1000', '1000+']
const REVENUE_RANGES = ['<$1M', '$1M-$5M', '$5M-$10M', '$10M-$50M', '$50M-$200M', '$200M+']
const TONES = ['professional', 'casual', 'direct', 'friendly', 'witty'] as const
type ToneKey = typeof TONES[number]
const TONE_ALIASES: Record<string, string> = { technical: 'direct', warm: 'friendly' }
function normalizeTone(raw?: string | null): ToneKey {
  const t = (raw || '').toLowerCase()
  if ((TONES as readonly string[]).includes(t)) return t as ToneKey
  return (TONE_ALIASES[t] ?? 'professional') as ToneKey
}

const cardCls   = 'bg-white border border-[#e8e3dc] rounded-2xl p-6 shadow-sm flex flex-col'
const sectionHd = 'text-xs font-bold text-[#8a7e6e] uppercase tracking-wider'
const inputCls  = 'w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#3b6bef]'
const labelCls  = 'text-xs font-medium text-[#6b5e4e]'

// Unified state: offer + ICP + parse all live in ONE form so setForm(...)
// after an autofill parse updates every field currently visible on the page.
// Fixes the pre-refactor bug where handleAutoFillApply's icpFormUpdate was a
// no-op because the Settings form state didn't carry ICP keys (icp_description,
// target_titles, target_regions, icp_company_sizes, pain_points, tone).
type ProfileFormState = {
  // Offer
  company_website:      string
  product_description:  string
  value_proposition:    string
  user_industry:        string
  user_company_size:    string
  // ICP
  icp_description:      string
  icp_industry:         string          // single-value editor → serialised as [icp_industry] in icp_industries
  target_titles:        string          // comma-separated CSV
  target_regions:       string          // comma-separated CSV
  icp_company_sizes:    string[]
  target_company_revenue: string[]
  pain_points:          string
  tone:                 ToneKey
}

const DEFAULT_FORM: ProfileFormState = {
  company_website:      '',
  product_description:  '',
  value_proposition:    '',
  user_industry:        '',
  user_company_size:    '',
  icp_description:      '',
  icp_industry:         '',
  target_titles:        '',
  target_regions:       '',
  icp_company_sizes:    [],
  target_company_revenue: [],
  pain_points:          '',
  tone:                 'professional',
}

const OFFER_KEYS = ['company_website','product_description','value_proposition','user_industry','user_company_size'] as const
const ICP_KEYS   = ['icp_description','icp_industry','target_titles','target_regions','icp_company_sizes','target_company_revenue','pain_points','tone'] as const

export default function ProfileIcpPage() {
  const t         = useTranslations('dashboard.profile')
  const tCommon   = useTranslations('dashboard.settings.common')
  const { workspace } = useWorkspace()
  const workspaceId = workspace?.workspace_id ?? null

  const [form, setForm]         = useState<ProfileFormState>(DEFAULT_FORM)
  const [snapshot, setSnapshot] = useState<ProfileFormState>(DEFAULT_FORM)
  const [fullProfile, setFullProfile] = useState<Record<string, unknown> | null>(null)
  const [loaded, setLoaded]     = useState(false)
  const [savingSection, setSavingSection] = useState<'offer' | 'icp' | null>(null)
  const [savedSection, setSavedSection]   = useState<'offer' | 'icp' | null>(null)
  const [aiParsing, setAiParsing]         = useState(false)
  const [toast, setToast]                 = useState<{ type: 'info' | 'error'; msg: string } | null>(null)

  // Hydrate from DB.
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    supabase
      .from('workspace_profiles')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
      .then(({ data: p }) => {
        if (cancelled) return
        if (!p) { setLoaded(true); return }
        const loadedForm: ProfileFormState = {
          company_website:        (p.company_website     as string) || '',
          product_description:    (p.product_description as string) || '',
          value_proposition:      (p.value_proposition   as string) || '',
          user_industry:          (p.user_industry       as string) || '',
          user_company_size:      (p.user_company_size   as string) || '',
          icp_description:        (p.icp_description     as string) || '',
          icp_industry:           (p.icp_industries as string[] | null)?.[0] ?? '',
          target_titles:          (p.target_titles       as string) || '',
          target_regions:         (p.target_regions      as string) || '',
          icp_company_sizes:      (p.icp_company_sizes as string[] | null) ?? (p.icp_company_size ? [p.icp_company_size as string] : []),
          target_company_revenue: (p.target_company_revenue as string[] | null) ?? [],
          pain_points:            (p.pain_points         as string) || '',
          tone:                   normalizeTone(p.tone as string | null),
        }
        setForm(loadedForm)
        setSnapshot(loadedForm)
        setFullProfile(p as Record<string, unknown>)
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [workspaceId])

  // Parse from website — writes to server AND merges result into local form.
  // Every column persisted is also reflected in the state, so the user sees
  // every field update after applying the preview (fixes the pre-refactor
  // "toast says 10 filled but I only see 2 change" bug).
  async function handleAutoFillApply(extracted: ExtractedFields) {
    if (!workspaceId) return
    const prev = { ...form }

    const update: Partial<ProfileFormState> = {}
    if (extracted.industry            !== undefined) update.user_industry       = extracted.industry as string
    if (extracted.user_company_size   !== undefined) update.user_company_size   = extracted.user_company_size as string
    if (extracted.product_description !== undefined) update.product_description = extracted.product_description as string
    if (extracted.value_proposition   !== undefined) update.value_proposition   = extracted.value_proposition as string
    if (extracted.icp_description     !== undefined) update.icp_description     = extracted.icp_description as string
    if (extracted.target_industry     !== undefined) update.icp_industry        = extracted.target_industry as string
    if (extracted.target_titles       !== undefined) update.target_titles       = (extracted.target_titles as string[]).join(', ')
    if (extracted.target_regions      !== undefined) update.target_regions      = (extracted.target_regions as string[]).join(', ')
    if (extracted.target_company_size !== undefined) update.icp_company_sizes   = extracted.target_company_size as string[]
    if (extracted.target_pain_points  !== undefined) update.pain_points         = extracted.target_pain_points as string
    if (extracted.email_tone          !== undefined) update.tone                = normalizeTone(extracted.email_tone as string)

    // Optimistic local update — reflects across BOTH sections instantly.
    setForm(f => ({ ...f, ...update }))

    // Persist server-side (same route the pre-refactor code used).
    const payload: Record<string, unknown> = { workspace_id: workspaceId }
    if (extracted.industry            !== undefined) payload.user_industry    = extracted.industry
    if (extracted.user_company_size   !== undefined) payload.user_company_size = extracted.user_company_size
    if (extracted.product_description !== undefined) payload.product_description = extracted.product_description
    if (extracted.value_proposition   !== undefined) payload.value_proposition = extracted.value_proposition
    if (extracted.icp_description     !== undefined) payload.icp_description  = extracted.icp_description
    if (extracted.target_industry     !== undefined) payload.icp_industries   = [extracted.target_industry]
    if (extracted.target_titles       !== undefined) payload.target_titles    = (extracted.target_titles as string[]).join(', ')
    if (extracted.target_regions      !== undefined) payload.target_regions   = (extracted.target_regions as string[]).join(', ')
    if (extracted.target_company_size !== undefined) payload.icp_company_sizes = extracted.target_company_size
    if (extracted.target_pain_points  !== undefined) payload.pain_points      = extracted.target_pain_points
    if (extracted.email_tone          !== undefined) payload.tone             = extracted.email_tone

    const filledCount = Object.keys(payload).length - 1
    const res = await fetch('/api/workspace/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      setForm(prev)
      setToast({ type: 'error', msg: t('toasts.autofillFailed') })
      setTimeout(() => setToast(null), 4000)
      return
    }
    // Sync snapshot for the fields that were autofilled.
    setSnapshot(s => ({ ...s, ...update }))
    setToast({ type: 'info', msg: t('toasts.autofillSaved', { count: filledCount }) })
    setTimeout(() => setToast(null), 4000)
  }

  // AI parse of icp_description → structured ICP fields.
  async function handleAiParse() {
    if (!form.icp_description.trim()) return
    setAiParsing(true)
    try {
      const res = await fetch('/api/icp/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: form.icp_description }),
      })
      const data = await res.json()
      if (data.icp) {
        const { icp } = data
        setForm(f => ({
          ...f,
          icp_industry:   icp.industries?.[0]     || f.icp_industry,
          target_titles:  icp.titles?.join(', ')  || f.target_titles,
          target_regions: icp.regions?.join(', ') || f.target_regions,
          icp_company_sizes: Array.isArray(icp.company_sizes) && icp.company_sizes.length > 0
            ? icp.company_sizes : f.icp_company_sizes,
          pain_points:    icp.pain_points || f.pain_points,
          tone:           normalizeTone(icp.tone) || f.tone,
        }))
      }
    } finally {
      setAiParsing(false)
    }
  }

  async function saveOffer() {
    if (!workspaceId) return
    setSavingSection('offer')
    const res = await fetch('/api/workspace/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id:        workspaceId,
        company_website:     form.company_website,
        product_description: form.product_description,
        value_proposition:   form.value_proposition,
        user_industry:       form.user_industry,
        user_company_size:   form.user_company_size,
      }),
    })
    setSavingSection(null)
    if (!res.ok) {
      setToast({ type: 'error', msg: tCommon('failedToSave') })
      setTimeout(() => setToast(null), 4000)
      return
    }
    setSnapshot(s => ({
      ...s,
      company_website:     form.company_website,
      product_description: form.product_description,
      value_proposition:   form.value_proposition,
      user_industry:       form.user_industry,
      user_company_size:   form.user_company_size,
    }))
    setSavedSection('offer')
    setTimeout(() => setSavedSection(null), 2000)
  }

  async function saveIcp() {
    if (!workspaceId) return
    setSavingSection('icp')
    const res = await fetch('/api/workspace/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id:           workspaceId,
        icp_description:        form.icp_description,
        icp_industries:         form.icp_industry ? [form.icp_industry] : [],
        target_titles:          form.target_titles,
        target_regions:         form.target_regions,
        icp_company_sizes:      form.icp_company_sizes,
        target_company_revenue: form.target_company_revenue,
        pain_points:            form.pain_points,
        tone:                   form.tone,
      }),
    })
    setSavingSection(null)
    if (!res.ok) {
      setToast({ type: 'error', msg: tCommon('failedToSave') })
      setTimeout(() => setToast(null), 4000)
      return
    }
    setSnapshot(s => ({
      ...s,
      icp_description:        form.icp_description,
      icp_industry:           form.icp_industry,
      target_titles:          form.target_titles,
      target_regions:         form.target_regions,
      icp_company_sizes:      form.icp_company_sizes,
      target_company_revenue: form.target_company_revenue,
      pain_points:            form.pain_points,
      tone:                   form.tone,
    }))
    setSavedSection('icp')
    setTimeout(() => setSavedSection(null), 2000)
  }

  const offerDirty = useMemo(
    () => OFFER_KEYS.some(k => form[k] !== snapshot[k]),
    [form, snapshot],
  )
  const icpDirty = useMemo(
    () => ICP_KEYS.some(k => JSON.stringify(form[k]) !== JSON.stringify(snapshot[k])),
    [form, snapshot],
  )

  // Score input for ProfileQualityBadge: dérivé du form courant + colonnes profil non éditées ici.
  const profileForScore = fullProfile ? {
    user_industry:       form.user_industry,
    user_company_size:   form.user_company_size,
    product_description: form.product_description,
    value_proposition:   form.value_proposition,
    icp_description:     form.icp_description,
    sender_name:         (fullProfile.sender_name as string) ?? '',
    icp_industries:      form.icp_industry ? [form.icp_industry] : [],
    icp_company_sizes:   form.icp_company_sizes,
    icp_company_size:    form.icp_company_sizes[0] ?? '',
    pain_points:         form.pain_points,
    target_titles:       form.target_titles,
    target_regions:      form.target_regions,
    tone:                form.tone,
  } : null

  return (
    <div className="max-w-5xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border px-4 py-3 shadow-lg flex items-start gap-3 text-sm ${
          toast.type === 'error'
            ? 'bg-red-50 border-red-200 text-red-800'
            : 'bg-[#1a1a2e] border-[#1a1a2e] text-white'
        }`}>
          <span aria-hidden="true">{toast.type === 'error' ? '⚠️' : 'ℹ'}</span>
          <div className="flex-1">{toast.msg}</div>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label={t('actions.close')}
            className="opacity-70 hover:opacity-100 text-base leading-none shrink-0"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <div className="text-xs text-[#8a7e6e] mb-1">
          <Link href="/dashboard" className="hover:text-[#1a1a2e]">{t('breadcrumbDashboard')}</Link> / {t('breadcrumbCurrent')}
        </div>
        <h1 className="text-2xl font-bold text-[#1a1a2e]">{t('header.title')}</h1>
        <p className="text-sm text-[#8a7e6e]">{t('header.subtitle')}</p>
      </div>

      {loaded && profileForScore && (
        <ProfileQualityBadge profile={profileForScore} hideEditLink={true} sticky dismissible className="mb-4" />
      )}

      {/* Section — Offer (product + website + parse) */}
      <section id="offre" className={`${cardCls} scroll-mt-16 mb-6`}>
        <div className="flex items-center gap-1.5 mb-4">
          <span className={sectionHd}>{t('offer.sectionTitle')}</span>
          <Tooltip content={t('offer.tooltip')}>
            <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </Tooltip>
        </div>
        <p className="text-sm text-[#6b5e4e] mb-4">{t('offer.description')}</p>

        <div className="flex flex-col gap-3 flex-1">
          {/* Website + autofill */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className={labelCls} htmlFor="prof-website">{t('offer.website')}</label>
              <StatusBadge variant="gray">{t('offer.websiteBadge')}</StatusBadge>
            </div>
            <div className="flex items-start gap-2">
              <input
                id="prof-website"
                value={form.company_website}
                onChange={e => setForm(f => ({ ...f, company_website: e.target.value }))}
                className={`${inputCls} flex-1`}
                placeholder={t('offer.websitePlaceholder')}
              />
              <AutoFillFromUrlButton websiteValue={form.company_website} onApply={handleAutoFillApply} />
            </div>
            <p className="text-xs text-[#8a7e6e] mt-1.5">{t('offer.websiteHint')}</p>
          </div>

          {/* Product description */}
          <div>
            <label className={`${labelCls} mb-1 block`} htmlFor="prof-product-desc">
              {t('offer.productDescription')} <span className="text-red-500">*</span>
            </label>
            <textarea
              id="prof-product-desc"
              value={form.product_description}
              onChange={e => setForm(f => ({ ...f, product_description: e.target.value }))}
              rows={3}
              className={`${inputCls} resize-none`}
            />
            <p className={`text-xs mt-1 ${form.product_description.length >= 30 ? 'text-green-600' : 'text-[#8a7e6e]'}`}>
              {form.product_description.length >= 30
                ? t('offer.charsDone', { count: form.product_description.length, limit: 30 })
                : t('offer.chars', { count: form.product_description.length, limit: 30 })}
            </p>
          </div>

          {/* Value proposition */}
          <div>
            <label className={`${labelCls} mb-1 block`} htmlFor="prof-value-prop">{t('offer.valueProposition')}</label>
            <textarea
              id="prof-value-prop"
              value={form.value_proposition}
              onChange={e => setForm(f => ({ ...f, value_proposition: e.target.value }))}
              rows={2}
              className={`${inputCls} resize-none`}
            />
            <p className={`text-xs mt-1 ${form.value_proposition.length >= 20 ? 'text-green-600' : 'text-[#8a7e6e]'}`}>
              {form.value_proposition.length >= 20
                ? t('offer.charsDone', { count: form.value_proposition.length, limit: 20 })
                : t('offer.chars', { count: form.value_proposition.length, limit: 20 })}
            </p>
          </div>

          {/* Industry + Company size (grid) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={`${labelCls} mb-1 block`} htmlFor="prof-industry">{t('offer.industry')}</label>
              <input
                id="prof-industry"
                value={form.user_industry}
                onChange={e => setForm(f => ({ ...f, user_industry: e.target.value }))}
                className={inputCls}
                placeholder={t('offer.industryPlaceholder')}
              />
            </div>
            <div>
              <label className={`${labelCls} mb-1 block`} htmlFor="prof-company-size">{t('offer.companySize')}</label>
              <select
                id="prof-company-size"
                value={form.user_company_size}
                onChange={e => setForm(f => ({ ...f, user_company_size: e.target.value }))}
                className={inputCls}
              >
                <option value="">{t('offer.companySizeEmpty')}</option>
                {COMPANY_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            type="button"
            onClick={saveOffer}
            disabled={!offerDirty || savingSection === 'offer'}
            className="bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
          >
            {savingSection === 'offer'
              ? t('actions.saving')
              : savedSection === 'offer'
                ? t('actions.saved')
                : t('actions.saveOffer')}
          </button>
        </div>
      </section>

      {/* Section — ICP */}
      <section id="icp" className={`${cardCls} scroll-mt-16 mb-6 bg-[#f7f8ff] border-[#dde6fd]`}>
        <div className="flex items-center gap-2 mb-2">
          <span aria-hidden="true">🎯</span>
          <span className={sectionHd}>{t('icp.sectionTitle')}</span>
          <StatusBadge variant="blueprint">{t('icp.sourceOfTruth')}</StatusBadge>
        </div>
        <p className="text-sm text-[#6b5e4e] mb-5">{t('icp.description')}</p>

        {/* Description + AI parse */}
        <div className="bg-white border border-[#dde6fd] rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[#3b6bef] font-medium text-sm">✨ {t('icp.aiHelper')}</span>
          </div>
          <textarea
            aria-label={t('icp.aiTextareaLabel')}
            value={form.icp_description}
            onChange={e => setForm(f => ({ ...f, icp_description: e.target.value }))}
            rows={4}
            placeholder={t('icp.aiPlaceholder')}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 focus:outline-none focus:border-[#3b6bef] resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            <span className={`text-xs ${form.icp_description.length >= 30 ? 'text-green-600' : 'text-[#8a7e6e]'}`}>
              {form.icp_description.length >= 30
                ? t('icp.charsCounterDone', { count: form.icp_description.length, limit: 30 })
                : t('icp.charsCounter', { count: form.icp_description.length, limit: 30 })}
            </span>
            <button
              type="button"
              onClick={handleAiParse}
              disabled={aiParsing || !form.icp_description.trim()}
              className="bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
            >
              {aiParsing ? t('icp.parsing') : `✨ ${t('icp.parseWithAi')}`}
            </button>
          </div>
        </div>

        <h3 className="text-[#3b6bef] font-semibold mb-4 text-sm">{t('icp.structuredIcp')}</h3>

        {/* Industry + Titles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className={`${labelCls} mb-1 block`} htmlFor="icp-industry">{t('icp.labels.industry')}</label>
            <input
              id="icp-industry"
              value={form.icp_industry}
              onChange={e => setForm(f => ({ ...f, icp_industry: e.target.value }))}
              className={inputCls}
              placeholder={t('icp.placeholders.industry')}
            />
          </div>
          <div>
            <label className={`${labelCls} mb-1 block`} htmlFor="icp-titles">{t('icp.labels.titles')}</label>
            <input
              id="icp-titles"
              value={form.target_titles}
              onChange={e => setForm(f => ({ ...f, target_titles: e.target.value }))}
              className={inputCls}
              placeholder={t('icp.placeholders.titles')}
            />
          </div>
        </div>

        {/* Regions + Pain points */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className={`${labelCls} mb-1 block`} htmlFor="icp-regions">{t('icp.labels.regions')}</label>
            <input
              id="icp-regions"
              value={form.target_regions}
              onChange={e => setForm(f => ({ ...f, target_regions: e.target.value }))}
              className={inputCls}
              placeholder={t('icp.placeholders.regions')}
            />
          </div>
          <div>
            <label className={`${labelCls} mb-1 block`} htmlFor="icp-pain">{t('icp.labels.painPoints')}</label>
            <textarea
              id="icp-pain"
              value={form.pain_points}
              onChange={e => setForm(f => ({ ...f, pain_points: e.target.value }))}
              rows={2}
              placeholder={t('icp.placeholders.painPoints')}
              className={`${inputCls} resize-none`}
            />
          </div>
        </div>

        {/* Company sizes + Revenue */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className={`${labelCls} mb-2 block`}>{t('icp.labels.companySize')}</label>
            <div className="flex flex-wrap gap-1.5">
              {COMPANY_SIZES.map(s => {
                const active = form.icp_company_sizes.includes(s)
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm(f => ({
                      ...f,
                      icp_company_sizes: active ? f.icp_company_sizes.filter(x => x !== s) : [...f.icp_company_sizes, s],
                    }))}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-[#3b6bef] text-white border-[#3b6bef]'
                        : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#3b6bef]'
                    }`}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className={`${labelCls} mb-2 block`}>
              {t('icp.labels.companyRevenue')} <span className="text-[#8a7e6e] font-normal">{t('icp.optional')}</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {REVENUE_RANGES.map(r => {
                const active = form.target_company_revenue.includes(r)
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setForm(f => ({
                      ...f,
                      target_company_revenue: active ? f.target_company_revenue.filter(x => x !== r) : [...f.target_company_revenue, r],
                    }))}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-[#3b6bef] text-white border-[#3b6bef]'
                        : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#3b6bef]'
                    }`}
                  >
                    {r}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Tone */}
        <div className="mb-4">
          <label className={`${labelCls} mb-2 block`}>{t('icp.labels.emailTone')}</label>
          <div className="flex flex-wrap gap-1.5">
            {TONES.map(k => (
              <button
                key={k}
                type="button"
                onClick={() => setForm(f => ({ ...f, tone: k }))}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  form.tone === k
                    ? 'bg-[#3b6bef] text-white border-[#3b6bef]'
                    : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#3b6bef]'
                }`}
              >
                {t(`icp.tones.${k}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <button
            type="button"
            onClick={saveIcp}
            disabled={!icpDirty || savingSection === 'icp'}
            className="bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
          >
            {savingSection === 'icp'
              ? t('actions.saving')
              : savedSection === 'icp'
                ? t('actions.saved')
                : t('actions.saveIcp')}
          </button>
        </div>
      </section>
    </div>
  )
}
